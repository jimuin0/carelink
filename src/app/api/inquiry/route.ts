import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { withRoute } from '@/lib/with-route';

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

  return NextResponse.json({ success: true, id: data.id });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'facility-inquiry' },
  sentryTag: 'inquiry',
});
