import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { sendInquiryReply } from '@/lib/email';
import { serverError } from '@/lib/with-route';

/**
 * お問い合わせへの返信を送信する（プラットフォーム管理者のみ）。
 *
 * 【2026年7月28日 新設】従来、管理画面の返信は mailto: リンクで担当者のメールアプリを
 * 開くだけだった。そのため返信は担当者個人のメールアカウントから送られ、問い合わせ者には
 * 運営の個人アドレスが差出人として表示されていた（/legal に support@carelink-jp.com を
 * 記載しているのに別アドレスから返事が来る状態）。
 * ここから送ることで差出人は常に EMAIL_FROM（carelink-jp.com の検証済みドメイン）になり、
 * 返信内容も contact_replies に残るため「言った・言わない」も追跡できる。
 */
const replySchema = z.object({
  body: z.string().trim().min(1, '返信内容を入力してください').max(5000),
});

async function getPlatformAdminUser(): Promise<{ id: string; name: string | null } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 列名は src/lib/schema-snapshot.json で実在を確認済み（profiles に full_name は無く display_name が正）。
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.is_platform_admin) return null;
  return { id: user.id, name: (profile as { display_name?: string | null }).display_name ?? null };
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-inquiries-reply')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const admin = await getPlatformAdminUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data: contact, error: fetchError } = await service
    .from('contacts')
    .select('id, name, email')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) return serverError('admin-inquiries-reply-fetch', fetchError, '/api/admin/inquiries/[id]/reply');
  if (!contact) return NextResponse.json({ error: 'チケットが見つかりません' }, { status: 404 });

  const target = contact as { id: string; name: string | null; email: string | null };
  if (!target.email) {
    return NextResponse.json({ error: 'この問い合わせにはメールアドレスが登録されていません' }, { status: 400 });
  }

  // 送信が失敗したまま「返信済み」として記録すると、相手は返事を待ち続けるのに運営は
  // 対応済みと誤認する（最も避けたい無音の失敗）。送信成功を確認してから記録する。
  const sent = await sendInquiryReply({
    to: target.email,
    inquirerName: target.name || 'お客様',
    body: parsed.data.body,
  });
  if (!sent) {
    return NextResponse.json({ error: 'メール送信に失敗しました。時間をおいて再試行してください' }, { status: 502 });
  }

  // contact_replies.author_name は NOT NULL DEFAULT '担当者'（migration 20260417000008）。
  // profiles.display_name は null になり得るため、admin.name をそのまま渡すと
  // NULL 明示指定で NOT NULL 制約に違反し insert が失敗する実バグだった（この insert の失敗は
  // 下の catch で握り潰されログ出力のみ・応答は成功のまま返るため、表示名未設定の管理者が
  // 返信すると返信履歴が無音で記録されない事故になっていた）。
  // null のときはキー自体を省略して DB 側の DEFAULT '担当者' に委ねる（新規作成なので
  // 既定値に倒すのが正しい＝CLAUDE.md の PATCH clobber ガードの対象外＝INSERT）。
  const { error: insertError } = await service.from('contact_replies').insert({
    contact_id: target.id,
    author_id: admin.id,
    ...(admin.name !== null ? { author_name: admin.name } : {}),
    body: parsed.data.body,
    is_internal: false,
    sent_at: new Date().toISOString(),
  });
  // 送信は完了しているため、履歴保存の失敗で 500 を返すと運営が二重送信しかねない。
  // 記録漏れは監査ログとアラートで拾い、レスポンスは成功として返す。
  if (insertError) {
    console.error('[admin/inquiries/reply] contact_replies insert failed:', insertError.message);
  }

  // 返信したら「返信待ち」のまま放置されないよう対応中へ進める。
  await service.from('contacts').update({ ticket_status: 'in_progress' }).eq('id', target.id);

  void writeAuditLog({
    userId: admin.id,
    action: 'create',
    tableName: 'contact_replies',
    recordId: target.id,
    newValues: { contact_id: target.id, sent: true },
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}
