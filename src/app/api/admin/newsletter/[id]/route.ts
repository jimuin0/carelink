import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { serverError } from '@/lib/with-route';
import { inspectNewsletterOperation, publishNewsletterOperation, NewsletterSendError } from '@/lib/newsletter-send';

// ニュースレター専用の差出人。EMAIL_FROM(email.ts の既定送信元 noreply@)とは意図的に
// ローカル部を分けている（購読解除等の応答性を示す newsletter@）ため EMAIL_FROM を
// 流用せず、専用の環境変数で本番ドメイン変更に追従できるようにする（未設定時は
// 従来のハードコード値と同じ既定値にフォールバックし後方互換を維持）。
// 送信元は email-from.ts が SSOT（未検証ドメインは検証済み既定値へ倒れる）。

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000 * 10, 'newsletter-send')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action, expected_updated_at } = await req.json().catch(() => ({}));
  const admin = createServiceRoleClient();

  const { data: campaign, error: fetchErr } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchErr && fetchErr.code !== 'PGRST116') return serverError('admin-newsletter-read', fetchErr, '/api/admin/newsletter/[id]');
  if (fetchErr || !campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (action === 'cancel') {
    if (campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Only scheduled campaigns can be cancelled' }, { status: 400 });
    }
    // 直前の fetch とこの update の間の TOCTOU（他リクエストが先に状態を変更 / 削除）で
    // 0件更新になっても、従来は .single() が PGRST116 を投げ 500 に丸められていた
    // （phantom success ではないが誤ったステータスコード）。status='scheduled' を
    // update 自体の WHERE 条件にも入れて楽観的並行制御にし、.select() で行数を検証、
    // 0件は「状態変化による競合」として 409 を返す（send の claim と同型）。
    const { data: updated, error: cancelErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'scheduled')
      .select();
    if (cancelErr) return serverError('admin-newsletter-cancel', cancelErr, '/api/admin/newsletter/[id]');
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'キャンペーンの状態が変更されているため取り消せません' }, { status: 409 });
    }

    {
      const { ip: auditIp, ua } = getRequestContext(req);
      void writeAuditLog({
        userId: user.id,
        action: 'cancel',
        tableName: 'newsletter_campaigns',
        recordId: params.id,
        oldValues: { status: campaign.status },
        newValues: { status: 'cancelled' },
        ipAddress: auditIp,
        userAgent: ua,
      });
    }

    return NextResponse.json({ campaign: updated[0] });
  }

  if (action === 'schedule') {
    if (campaign.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft campaigns can be scheduled' }, { status: 400 });
    }
    // cancel と同型: TOCTOU による0件更新を、楽観的並行制御(status='draft'をWHEREに追加)＋
    // 行数検証で 409 に正しく分類する（従来は .single() が0件で 500 に丸めていた）。
    const { data: updated, error: scheduleErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'draft')
      .select();
    if (scheduleErr) return serverError('admin-newsletter-schedule', scheduleErr, '/api/admin/newsletter/[id]');
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'キャンペーンの状態が変更されているため予約できません' }, { status: 409 });
    }

    {
      // AuditAction に 'schedule' 相当の値が無いため、状態遷移を表す 'update' で記録する
      // （cancel は AuditAction に専用値があるため 'cancel' を使う）。
      const { ip: auditIp, ua } = getRequestContext(req);
      void writeAuditLog({
        userId: user.id,
        action: 'update',
        tableName: 'newsletter_campaigns',
        recordId: params.id,
        oldValues: { status: campaign.status },
        newValues: { status: 'scheduled' },
        ipAddress: auditIp,
        userAgent: ua,
      });
    }

    return NextResponse.json({ campaign: updated[0] });
  }

  if (action === 'send' || action === 'inspect') {
    try {
      const existing = await inspectNewsletterOperation(admin, user.id, params.id);
      if (action === 'inspect' && existing === null) {
        return NextResponse.json({ campaign, receipt: null, message: '受付はまだ確認できません。同じキャンペーンから再確認してください。' });
      }
      if (existing === null && !['draft', 'scheduled'].includes(campaign.status)) throw new NewsletterSendError(409, '既存配信の結果を確認してください。結果不明の配信は再送しません。');
      const receipt = existing ?? await publishNewsletterOperation(admin, user.id, campaign, expected_updated_at);
      const { data: current, error: currentError } = await admin.from('newsletter_campaigns').select('*').eq('id', params.id).single();
      if (currentError || !current) throw new NewsletterSendError(503, '受付後の状態を確認できません。同じキャンペーンの受付状況を確認してください。');
      return NextResponse.json({ campaign: current, receipt, message: '送信キューへの受付を確認しました。メール提供元の受理と実際の到達は別途確認が必要です。' });
    } catch (error) {
      if (error instanceof NewsletterSendError) return NextResponse.json({ error: error.message }, { status: error.status });
      return serverError('admin-newsletter-operation', error, '/api/admin/newsletter/[id]', '受付状況を確認できません。同じキャンペーンから再確認してください。');
    }
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
