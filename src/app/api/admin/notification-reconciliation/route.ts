import { z } from 'zod';
import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { eventEmailEnvelopeSchema, verifyEventEmailAcceptance } from '@/lib/event-email-delivery';
import { withRoute, authUnavailable, serverError } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { writeAuditLog } from '@/lib/audit-logger';

const inputSchema = z.object({ operationId: z.uuid(), providerMessageId: z.uuid() }).strict();

/** Operator-only acceptance reconciliation. This endpoint never sends, clears
 * an unknown fence, edits an envelope, or starts a new operation. */
export const POST = withRoute(async request => {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: '不正な照合情報です' }, { status: 400 });
  const auth = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(auth.auth);
  if (verification.state === 'unavailable') return authUnavailable('notification-reconcile-auth', '/api/admin/notification-reconciliation');
  if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = verification.user;
  const permission = await auth.from('profiles').select('is_platform_admin').eq('id', user.id).maybeSingle();
  if (permission.error) return serverError('notification-reconcile-permission', new Error('permission observation failed'), '/api/admin/notification-reconciliation');
  if (permission.data?.is_platform_admin !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = createServiceRoleClient();
  const found = await db.from('webhook_retry_queue').select('id,webhook_type,payload,email_envelope,status,claimed_at,delivery_started_at,provider_message_id')
    .eq('id', input.data.operationId).maybeSingle();
  if (found.error) return serverError('notification-reconcile-read', new Error('notification observation failed'), '/api/admin/notification-reconciliation');
  const row = found.data;
  const envelope = eventEmailEnvelopeSchema.safeParse(row?.email_envelope);
  const generic = row?.webhook_type === 'email' && typeof row.payload === 'object' && row.payload !== null
    && !Array.isArray(row.payload) && row.payload.event_email_version === 1;
  if (!row || (!generic && row.webhook_type !== 'manual_booking_confirmation') || !envelope.success
    || !row.delivery_started_at || !row.claimed_at || !['processing', 'success'].includes(row.status)) {
    return NextResponse.json({ error: '照合可能な送信開始記録がありません' }, { status: 409 });
  }
  if (row.status === 'success') return NextResponse.json({ accepted: row.provider_message_id === input.data.providerMessageId },
    { status: row.provider_message_id === input.data.providerMessageId ? 200 : 409 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'メールサービスの照合設定がありません' }, { status: 503 });
  const accepted = await verifyEventEmailAcceptance(new Resend(process.env.RESEND_API_KEY), envelope.data, row.id,
    input.data.providerMessageId, row.delivery_started_at);
  if (!accepted) return NextResponse.json({ error: '保存内容と一致する受理証拠を確認できません。再送は行いません' }, { status: 409 });
  const marked = await db.from('webhook_retry_queue').update({ status: 'success', provider_message_id: input.data.providerMessageId,
    delivered_at: new Date().toISOString(), processed_at: new Date().toISOString(), last_error: null })
    .eq('id', row.id).eq('status', 'processing').eq('claimed_at', row.claimed_at)
    .eq('delivery_started_at', row.delivery_started_at).select('id').maybeSingle();
  if (marked.error) return serverError('notification-reconcile-write', new Error('acceptance recording unconfirmed'), '/api/admin/notification-reconciliation');
  if (marked.data?.id !== row.id) return NextResponse.json({ error: '状態が変わりました。同じ操作を再照合してください' }, { status: 409 });
  void writeAuditLog({ userId: user.id, action: 'update', tableName: 'webhook_retry_queue', recordId: row.id,
    newValues: { status: 'success', source: 'verified_provider_acceptance' } });
  return NextResponse.json({ accepted: true }, { headers: { 'Cache-Control': 'no-store' } });
}, { rateLimit: { limiter: null, limit: 10, windowMs: 60000, prefix: 'notification-reconciliation' }, sentryTag: 'notification-reconciliation' });
