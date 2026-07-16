import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { withRoute } from '@/lib/with-route';
import { sendNewInquiryNotification } from '@/lib/email';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { sendNotify } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// POST /api/inquiry : 施設への問い合わせの唯一の登録経路（service_role でサーバ挿入）。
//
// 【背景・恒久対策】
//   従来は InquiryForm.tsx がブラウザの anon キーで facility_inquiries へ直接 INSERT
//   していた。anon キーは公開JS（クライアントバンドル）に含まれ誰でも入手できるため、
//   RLS の `"Anyone can insert inquiries" TO anon WITH CHECK(true)` が開いている限り、
//   CSRF / rate-limit / サーバ検証を一切経由しない無制限・無検証の投入が可能だった
//   （発症前の構造的脆弱性）。本 API に集約し、対応する anon INSERT ポリシーを DB から
//   DROP することで「サーバを通さない投入」を物理的に不能化する。
//
// 【検証方針】
//   サーバを権威（authoritative）とする。facility_name はクライアント値を信用せず
//   facility_profiles（published）から引いて確定し、施設なりすまし・任意 facility_id
//   混入を拒否する。
// -----------------------------------------------------------------------------

const inquiryInsertSchema = z.object({
  facility_id: z.string().uuid(),
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  name: z.string().trim().min(1).max(100),
  email: z.string().email().max(254),
  phone: z
    .string()
    .max(20)
    .regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/, '正しい電話番号を入力してください')
    .or(z.literal(''))
    .optional()
    .nullable(),
  message: z.string().trim().min(1).max(1000),
});

export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => null);
  const parsed = inquiryInsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }
  const d = parsed.data;

  const supabase = createServiceRoleClient();

  // 施設の存在・公開確認（facility_name はサーバ権威で確定し、なりすましを拒否）
  const { data: facility, error: facilityErr } = await supabase
    .from('facility_profiles')
    .select('id, name')
    .eq('id', d.facility_id)
    .eq('status', 'published')
    .maybeSingle();

  // error を握り潰すと DB 障害を「施設が見つかりません(404)」に偽装してしまう（INQ-1）。
  // error は 500、データ無しのみ 404 に分ける（admin/report と同じ扱い）。
  if (facilityErr) {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
  if (!facility) {
    return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('facility_inquiries')
    .insert({
      facility_id: facility.id,
      facility_name: facility.name,
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      message: d.message,
    })
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: '送信に失敗しました。時間をおいて再度お試しください。' },
      { status: 500 }
    );
  }

  // 【2026年7月10日 恒久根治】保存のみで通知経路が存在せず、問い合わせが実質誰にも届かない
  // 構造的欠陥だった。施設の全オーナーへメール通知する（複数オーナー運用でも全員に届くよう、
  // /api/booking の owner 全員通知と同じパターンで一部のみに絞らない）。送信失敗はレスポンスを
  // ブロックしない（保存自体は成功しているため）が、無音にせず可視化する。
  const { data: ownerRows } = await supabase
    .from('facility_members')
    .select('user_id')
    .eq('facility_id', facility.id)
    .eq('role', 'owner');
  const ownerUserIds = Array.from(new Set(((ownerRows ?? []) as { user_id: string }[]).map((o) => o.user_id).filter(Boolean)));
  if (ownerUserIds.length > 0) {
    const { data: ownerProfiles } = await supabase.from('profiles').select('email').in('id', ownerUserIds);
    const ownerEmails = Array.from(new Set(
      ((ownerProfiles ?? []) as { email: string | null }[]).map((p) => p.email).filter(Boolean) as string[]
    ));
    await Promise.allSettled(
      ownerEmails.map((facilityEmail) =>
        sendNewInquiryNotification({
          facilityEmail,
          facilityName: facility.name,
          inquirerName: d.name,
          inquirerEmail: d.email,
          inquirerPhone: d.phone || null,
          message: d.message,
        }).then((ok) => {
          if (!ok) {
            const err = new Error('inquiry notification email send failed');
            safeCaptureException(err, 'inquiry-email-owner');
            alertCaughtError('inquiry-email-owner', err, '/api/inquiry');
          }
        }).catch((e) => {
          safeCaptureException(e, 'inquiry-email-owner');
          alertCaughtError('inquiry-email-owner', e, '/api/inquiry');
        })
      )
    );
  }

  // Slack通知（fire-and-forget）
  // 従来は InquiryForm.tsx が保存成功後にブラウザから /api/notify（認証なしの公開POST）を
  // 直接叩いていた。/api/notify は外部から偽Slackアラートを送れる構造的脆弱性のため廃止し、
  // 共有ロジック sendNotify をこのサーバー側から直接呼ぶ（contact.ts/salons.ts と同型）。
  // facility_name はクライアント値ではなく上で確定したサーバー権威の facility.name を使う
  // （なりすまし防止は上の facility_profiles 確認で既に担保済みだが、Slack表示も一貫させる）。
  sendNotify({
    type: 'facility_inquiry',
    data: {
      facility_name: facility.name,
      name: d.name,
      email: d.email,
      phone: d.phone || '未入力',
      message: d.message,
    },
  }).then((r) => {
    if (!r.ok) console.error('[inquiry] Slack notification failed', { error: r.error });
  }).catch((err) => console.error('[inquiry] Slack notification failed', { err }));

  return NextResponse.json({ success: true, id: data.id });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'facility-inquiry' },
  sentryTag: 'inquiry',
});
