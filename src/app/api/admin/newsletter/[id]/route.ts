import { writePlatformEditor } from '@/lib/platform-editor-write';
import { platformControlResponse } from '@/lib/platform-control-write';
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

async function handlePATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000 * 10, 'newsletter-send')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { action, expected_updated_at } = body;
  if (action === 'schedule') {
    return NextResponse.json({ code: 'NEWSLETTER_MANUAL_ONLY', error: 'ニュースレターは手動配信のみです。予約配信は受け付けていません。' }, { status: 400 });
  }
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
    const cancelled=await writePlatformEditor(user.id,params.id,'newsletter','cancel',{},'/api/admin/newsletter/[id]');
    if(cancelled instanceof NextResponse)return cancelled;

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

    return NextResponse.json({ campaign: cancelled });
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

export async function PATCH(request:NextRequest,props:{params:Promise<{id:string}>}){return platformControlResponse(()=>handlePATCH(request,props),'/api/admin/newsletter/[id]');}
