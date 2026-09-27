import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { sendInquiryReply } from '@/lib/email';
import { serverError, withRoute } from '@/lib/with-route';

const IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  operationId: z.string().regex(UUID_REGEX),
}).strict();

type ReplyRow = {
  id: string;
  contact_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  is_internal: boolean;
  sent_at: string | null;
  created_at: string;
};

async function getPlatformAdminUser(): Promise<{ id: string; name: string | null } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin, display_name')
    .eq('id', user.id)
    .single();

  if (!profile?.is_platform_admin) return null;
  return { id: user.id, name: profile.display_name ?? null };
}

function canRetryPendingReply(createdAt: string, now = Date.now()): boolean {
  const createdAtMs = Date.parse(createdAt);
  const age = now - createdAtMs;
  return Number.isFinite(createdAtMs) && age >= 0 && age < IDEMPOTENCY_RETRY_WINDOW_MS;
}

function noStoreJson(body: Record<string, unknown>, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function noStoreServerError(tag: string, cause: unknown, userMessage?: string, extraBody?: Record<string, unknown>) {
  const response = serverError(
    tag,
    cause,
    '/api/admin/inquiries/[id]/reply',
    userMessage ?? 'サーバーエラーが発生しました',
    extraBody,
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function protectUnexpectedErrors(tag: string, handler: () => Promise<NextResponse>) {
  return async (): Promise<NextResponse> => {
    try {
      return await handler();
    } catch {
      // Auth/provider exceptions can contain email addresses or credential details.
      // Log a fixed category instead of forwarding raw dependency errors to telemetry.
      return noStoreServerError(tag, new Error('unexpected_dependency_failure'));
    }
  };
}

async function findReplyById(service: ReturnType<typeof createServiceRoleClient>, operationId: string) {
  return service.from('contact_replies')
    .select('id, contact_id, author_id, author_name, body, is_internal, sent_at, created_at')
    .eq('id', operationId)
    .maybeSingle();
}

async function updateTicketAfterReply(service: ReturnType<typeof createServiceRoleClient>, contactId: string) {
  const { data, error } = await service.from('contacts')
    .update({ ticket_status: 'in_progress' })
    .eq('id', contactId)
    .select('id');
  return !error && data?.length === 1;
}

async function handleGet(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await props.params;
  if (!UUID_REGEX.test(id)) return noStoreJson({ error: '不正なIDです' }, 400);

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'admin-inquiries-reply-status')) {
    return noStoreJson({ error: 'リクエストが多すぎます' }, 429);
  }

  if (!await getPlatformAdminUser()) return noStoreJson({ error: 'Unauthorized' }, 401);

  const service = createServiceRoleClient();
  const pendingResult = await service.from('contact_replies')
    .select('id, contact_id, author_id, author_name, body, is_internal, sent_at, created_at')
    .eq('contact_id', id)
    .eq('is_internal', false)
    .is('sent_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingResult.error) return noStoreServerError('admin-inquiries-reply-status', new Error('reply_status_read_failed'));

  // A legacy or manually reconciled sent reply may be newer than an older pending row.
  // Prefer the unresolved operation so the UI cannot accidentally start a second reply.
  let replyData = pendingResult.data;
  if (!replyData) {
    const sentResult = await service.from('contact_replies')
      .select('id, contact_id, author_id, author_name, body, is_internal, sent_at, created_at')
      .eq('contact_id', id)
      .eq('is_internal', false)
      .not('sent_at', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sentResult.error) return noStoreServerError('admin-inquiries-reply-status', new Error('reply_status_read_failed'));
    replyData = sentResult.data;
  }

  const reply = replyData as ReplyRow | null;
  return noStoreJson({
    reply: reply ? {
      operationId: reply.id,
      body: reply.body,
      createdAt: reply.created_at,
      sentAt: reply.sent_at,
      retryable: reply.sent_at === null && canRetryPendingReply(reply.created_at),
    } : null,
  });
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const response = await withRoute(
    protectUnexpectedErrors('admin-inquiries-reply-status', () => handleGet(request, props)),
    { csrf: false, sentryTag: 'admin-inquiries-reply-status' },
  )(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function handlePost(request: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const params = await props.params;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-inquiries-reply')) {
    return noStoreJson({ error: 'リクエストが多すぎます' }, 429);
  }

  if (!UUID_REGEX.test(params.id)) return noStoreJson({ error: '不正なIDです' }, 400);
  const admin = await getPlatformAdminUser();
  if (!admin) return noStoreJson({ error: 'Unauthorized' }, 401);

  const json = await request.json().catch(() => null);
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return noStoreJson({ error: 'リクエストが不正です' }, 400);

  const service = createServiceRoleClient();
  const { data: contactData, error: contactError } = await service.from('contacts')
    .select('id, name, email')
    .eq('id', params.id)
    .maybeSingle();
  if (contactError) return noStoreServerError('admin-inquiries-reply-contact', new Error('contact_read_failed'));
  if (!contactData) return noStoreJson({ error: 'チケットが見つかりません' }, 404);

  const contact = contactData as { id: string; name: string | null; email: string | null };
  if (!contact.email) return noStoreJson({ error: 'この問い合わせにはメールアドレスが登録されていません' }, 400);

  const { body, operationId } = parsed.data;
  const existingResult = await findReplyById(service, operationId);
  if (existingResult.error) return noStoreServerError('admin-inquiries-reply-operation-read', new Error('reply_operation_read_failed'));

  let existing = existingResult.data as ReplyRow | null;
  if (existing && (existing.contact_id !== contact.id || existing.is_internal || existing.body !== body)) {
    return noStoreJson({ error: 'この返信操作IDは別の内容に使用済みです。送信状況を再読み込みしてください' }, 409);
  }

  if (!existing) {
    const { data: pendingData, error: pendingError } = await service.from('contact_replies')
      .select('id, contact_id, author_id, author_name, body, is_internal, sent_at, created_at')
      .eq('contact_id', contact.id)
      .eq('is_internal', false)
      .is('sent_at', null)
      .limit(1)
      .maybeSingle();
    if (pendingError) return noStoreServerError('admin-inquiries-reply-pending-read', new Error('pending_reply_read_failed'));
    if (pendingData) {
      return noStoreJson({ error: '未確定の返信があります。送信状況を再読み込みしてから同じ返信を再試行してください' }, 409);
    }

    const { error: insertError } = await service.from('contact_replies').insert({
      id: operationId,
      contact_id: contact.id,
      author_id: admin.id,
      ...(admin.name !== null ? { author_name: admin.name } : {}),
      body,
      is_internal: false,
    });

    if (insertError) {
      // Parallel requests with the same operation ID may race at the unique index.
      // Re-read by that ID and continue only if it is precisely the same payload.
      const reread = await findReplyById(service, operationId);
      if (reread.error) return noStoreServerError('admin-inquiries-reply-insert', new Error('reply_reservation_failed'));
      existing = reread.data as ReplyRow | null;
      if (!existing || existing.contact_id !== contact.id || existing.is_internal || existing.body !== body) {
        return noStoreJson({ error: '返信を安全に開始できませんでした。送信状況を再読み込みしてください' }, 409);
      }
    } else {
      existing = {
        id: operationId,
        contact_id: contact.id,
        author_id: admin.id,
        author_name: admin.name ?? '担当者',
        body,
        is_internal: false,
        sent_at: null,
        created_at: new Date().toISOString(),
      };
    }
  }

  if (existing.sent_at) {
    const ticketUpdated = await updateTicketAfterReply(service, contact.id);
    return noStoreJson({ ok: true, alreadySent: true, warning: ticketUpdated ? null : 'ticket_status_update_failed' });
  }
  if (!canRetryPendingReply(existing.created_at)) {
    return noStoreJson({ error: '送信結果が未確定のまま再送可能期間を過ぎました。重複防止のため自動再送を停止しました。送信記録を確認してください' }, 409);
  }

  const sent = await sendInquiryReply({
    to: contact.email,
    inquirerName: contact.name || 'お客様',
    body,
    idempotencyKey: operationId,
  });
  if (!sent) return noStoreJson({ error: '送信結果を確認できません。重複防止のため同じ操作IDでのみ再試行してください', pending: true }, 502);

  const { data: markedRows, error: markError } = await service.from('contact_replies')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', operationId)
    .eq('contact_id', contact.id)
    .eq('is_internal', false)
    .is('sent_at', null)
    .select('id');
  if (markError || markedRows?.length !== 1) {
    // Provider accepted the idempotent operation. Never report a clean failure that
    // would encourage a new operation ID; the same ID can reconcile during the window.
    const reread = await findReplyById(service, operationId);
    if (reread.data?.sent_at) {
      const ticketUpdated = await updateTicketAfterReply(service, contact.id);
      return noStoreJson({ ok: true, alreadySent: true, warning: ticketUpdated ? null : 'ticket_status_update_failed' });
    }
    return noStoreServerError(
      'admin-inquiries-reply-mark-sent',
      new Error('provider_accepted_reply_history_unconfirmed'),
      '送信結果を記録できません。重複防止のため同じ返信操作を維持してください',
      { pending: true },
    );
  }

  const ticketUpdated = await updateTicketAfterReply(service, contact.id);
  void writeAuditLog({
    userId: admin.id,
    action: 'create',
    tableName: 'contact_replies',
    recordId: operationId,
    newValues: { contact_id: contact.id, sent: true },
    ipAddress: ip,
  });

  return noStoreJson({ ok: true, alreadySent: false, warning: ticketUpdated ? null : 'ticket_status_update_failed' });
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const response = await withRoute(
    protectUnexpectedErrors('admin-inquiries-reply', () => handlePost(request, props)),
    { csrf: true, sentryTag: 'admin-inquiries-reply' },
  )(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
