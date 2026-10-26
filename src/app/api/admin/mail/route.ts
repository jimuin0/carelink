import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute, serverError, authUnavailable, type RouteContext } from '@/lib/with-route';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';
import { buildPlatformMailEnvelope, platformMailContactSchema, platformMailDraftSchema, platformMailRecordSchema, type PlatformMailRecord } from '@/lib/platform-mail-contract';
import { platformMailProvider, dispatchPlatformMail, inspectPlatformMail, cancelPlatformMail } from '@/lib/platform-mail-delivery';
import type { Json } from '@/types/database.types';
import { inquiryCursor } from '@/lib/admin-inquiry-list-contract';
import { readAdminInquiryList } from '@/lib/admin-inquiry-list';
import { readMailReplyEvidence, readMailThread } from '@/lib/platform-mail-read';
import { summarizeMailReplies } from '@/lib/platform-mail-contract';
import { databaseDiagnostic } from '@/lib/database-diagnostic';

export const dynamic = 'force-dynamic';
const path = '/api/admin/mail';
const headers = { 'Cache-Control': 'no-store' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
const folders = { draft: ['draft'], pending: ['pending'], scheduled: ['scheduled', 'cancelling'], sent: ['sent', 'cancelled'] };
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), draft: platformMailDraftSchema }).strict(),
  z.object({ action: z.literal('send'), id: z.uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('refresh'), id: z.uuid(), providerId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('cancel'), id: z.uuid() }).strict(),
]);
type DB = ReturnType<typeof createServiceRoleClient>;

async function authorize(ctx: RouteContext): Promise<NextResponse | null> {
  const profile = await ctx.supabase!.from('profiles').select('is_platform_admin').eq('id', ctx.user!.id).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if (profile.error) return authUnavailable('platform-mail', path);
  return profile.data?.is_platform_admin === true ? null : json({ error: '運営アカウントでログインしてください。' }, 403);
}

async function atomic(db: DB, actor: string, id: string, action: string, values: Json = {}): Promise<PlatformMailRecord | NextResponse> {
  const result = await db.rpc('manage_platform_mail_atomic', { p_actor_id: actor, p_mail_id: id, p_action: action, p_values: values }).abortSignal(AbortSignal.timeout(8000));
  if (result.error) {
    const code = result.error.code;
    if (code === '42501') return json({ error: '操作権限を再確認してください。' }, 403);
    if (code === 'P0002') return json({ error: 'メールが見つかりません。' }, 404);
    if (code === 'PT409' || code === '40001' || code === '23505') return json({ error: '内容または送信状況が変わりました。一覧を更新してご確認ください。' }, 409);
    if (['22023', '23514', '22P02'].includes(code)) return json({ error: '入力内容と送信日時をご確認ください。' }, 400);
    return serverError('platform-mail-write', databaseDiagnostic(result.error), path);
  }
  const record = platformMailRecordSchema.safeParse(result.data);
  if (!record.success || record.data.id !== id) return serverError('platform-mail-receipt', new Error('MAIL_RECEIPT_UNCONFIRMED'), path);
  return record.data;
}

async function list(request: Request, ctx: RouteContext) {
  try {
    const denied = await authorize(ctx);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['folder', 'cursor', 'id', 'contactId'].includes(key) || params.getAll(key).length !== 1)) return json({ error: '一覧の条件を確認してください。' }, 400);
    const db = createServiceRoleClient();
    if (params.has('contactId')) {
      if (params.size !== 1 || !z.uuid().safeParse(params.get('contactId')).success) return json({ error: 'お問い合わせを選び直してください。' }, 400);
      const result = await db.from('contacts').select('id,name,email,message,inquiry_type,created_at').eq('id', params.get('contactId')!).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
      if (result.error) return serverError('platform-mail-contact', new Error('MAIL_CONTACT_UNAVAILABLE'), path);
      if (!result.data) return json({ error: 'お問い合わせが見つかりません。' }, 404);
      const contact = platformMailContactSchema.safeParse(result.data);
      if (!contact.success) return serverError('platform-mail-contact', new Error('MAIL_CONTACT_RECEIPT_INVALID'), path);
      const history = await readMailThread(db, contact.data.id);
      return json({ contact: contact.data, ...history });
    }
    if (params.has('id')) {
      if (params.has('folder') || params.has('cursor') || !z.uuid().safeParse(params.get('id')).success) return json({ error: 'メールを選び直してください。' }, 400);
      const record = await atomic(db, ctx.user!.id, params.get('id')!, 'read');
      return record instanceof NextResponse ? record : json({ mail: record });
    }
    const folder = z.enum(['inbox', 'draft', 'pending', 'scheduled', 'sent', 'failed']).safeParse(params.get('folder') ?? 'draft');
    if (!folder.success) return json({ error: '一覧の条件を確認してください。' }, 400);
    if (folder.data === 'inbox') {
      let cursor: unknown = null;
      if (params.has('cursor')) {
        try { cursor = JSON.parse(params.get('cursor')!); } catch { return json({ error: '一覧を更新してください。' }, 400); }
        if (!inquiryCursor.safeParse(cursor).success) return json({ error: '一覧を更新してください。' }, 400);
      }
      const result = await readAdminInquiryList(db, { status: 'all', cursor });
      if (result.state !== 'confirmed') return serverError('platform-mail-inbox', new Error('MAIL_INBOX_UNAVAILABLE'), path);
      const evidence = await readMailReplyEvidence(db, result.contacts.map(contact => contact.id));
      return json({ contacts: result.contacts.map(contact => ({ ...contact, replySummary: summarizeMailReplies(
        evidence.messages.filter(mail => mail.contact_id === contact.id), evidence.replies.filter(reply => reply.contact_id === contact.id),
      ) })), nextCursor: result.nextCursor });
    }
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (params.has('cursor')) {
      let raw: unknown;
      try { raw = JSON.parse(params.get('cursor')!); } catch { return json({ error: '一覧を更新してください。' }, 400); }
      const parsed = cursorSchema.safeParse(raw);
      if (!parsed.success) return json({ error: '一覧を更新してください。' }, 400);
      cursor = parsed.data;
    }
    let query = db.from('platform_mail').select('*');
    query = folder.data === 'failed' ? query.in('delivery_status', ['failed', 'bounced']) : query.in('state', folders[folder.data]);
    query = query.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(41);
    if (cursor) query = query.or('updated_at.lt.' + cursor.at + ',and(updated_at.eq.' + cursor.at + ',id.lt.' + cursor.id + ')');
    const result = await query.abortSignal(AbortSignal.timeout(8000));
    const records = z.array(platformMailRecordSchema).max(41).safeParse(result.data);
    if (result.error || !records.success) return serverError('platform-mail-list', new Error('MAIL_LIST_UNAVAILABLE'), path);
    const messages = records.data.slice(0, 40);
    const last = messages[messages.length - 1];
    return json({ messages, nextCursor: records.data.length > 40 ? { at: last.updated_at, id: last.id } : null });
  } catch { return serverError('platform-mail-list', new Error('MAIL_LIST_REQUEST_FAILED'), path); }
}

async function post(request: Request, ctx: RouteContext) {
  try {
    const denied = await authorize(ctx);
    if (denied) return denied;
    const input = commandSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return json({ error: '入力内容をご確認ください。' }, 400);
    const command = input.data;
    const db = createServiceRoleClient();
    const actor = ctx.user!.id;
    if (command.action === 'save') {
      const record = await atomic(db, actor, command.draft.id, 'save', command.draft);
      if (record instanceof NextResponse) return record;
      void writeAuditLog({ userId: actor, action: 'update', tableName: 'platform_mail', recordId: record.id, newValues: { event: 'draft_saved' } });
      return json({ mail: record });
    }
    let record = await atomic(db, actor, command.id, 'read');
    if (record instanceof NextResponse) return record;
    const provider = platformMailProvider();
    if (!provider) return json({ error: '送信機能を利用できません。下書きは保持されています。' }, 503);

    if (command.action === 'send') {
      if (record.state !== 'draft' && record.state !== 'pending') return json({ error: 'このメールは送信操作済みです。一覧を更新してください。' }, 409);
      if (record.state === 'pending' && (!record.reserved_at || Date.now() - Date.parse(record.reserved_at) >= 23 * 3600000)) {
        return json({ error: '結果を確認できません。再送信せず、運営で送信記録を確認してください。' }, 409);
      }
      let envelope;
      try {
        envelope = record.state === 'pending' ? record.envelope! : buildPlatformMailEnvelope({
          id: record.id, revision: record.revision, contactId: record.contact_id, to: record.recipient,
          subject: record.subject, body: record.body, scheduledAt: record.scheduled_at,
        });
      } catch { return json({ error: '宛先・件名・本文と、1分後から30日以内の送信日時をご確認ください。' }, 400); }
      const reserved = await atomic(db, actor, record.id, 'reserve', { revision: command.revision, envelope });
      if (reserved instanceof NextResponse) return reserved;
      record = reserved;
      const acceptance = await dispatchPlatformMail(provider, record.envelope!, record.id);
      if (acceptance.state === 'unknown') return json({ mail: record, warning: '送信結果を確認できません。同じメールを作り直さず、この画面で状況を確認してください。' }, 202);
      const confirmed = await atomic(db, actor, record.id, 'observe', { providerId: acceptance.id, event: 'accepted' });
      if (confirmed instanceof NextResponse) {
        if (confirmed.status === 403) return confirmed;
        return json({ mail: record, providerId: acceptance.id, warning: '送信結果の保存を確認できません。状況を確認してください。' }, 202);
      }
      void writeAuditLog({ userId: actor, action: 'confirm', tableName: 'platform_mail', recordId: record.id, newValues: { event: 'provider_accepted', state: confirmed.state } });
      return json({ mail: confirmed });
    }

    const providerId = command.action === 'refresh' ? command.providerId ?? record.provider_message_id : record.provider_message_id;
    if (!providerId || !record.envelope || !record.reserved_at || (record.provider_message_id && providerId !== record.provider_message_id)) {
      return json({ error: 'このメールの送信記録を確認できません。再送信せず状況をご確認ください。' }, 409);
    }
    if (command.action === 'cancel') {
      const cancelling = await atomic(db, actor, record.id, 'cancel');
      if (cancelling instanceof NextResponse) return cancelling;
      record = cancelling;
    }
    const observation = command.action === 'cancel'
      ? await cancelPlatformMail(provider, record.envelope!, record.id, providerId, record.reserved_at!)
      : await inspectPlatformMail(provider, record.envelope!, record.id, providerId, record.reserved_at!);
    if (!observation) return json({ mail: record, warning: '送信状況を確認できません。内容は保持されています。時間をおいて更新してください。' }, 202);
    const confirmed = await atomic(db, actor, record.id, 'observe', { providerId: observation.id, event: observation.event });
    if (confirmed instanceof NextResponse) return confirmed;
    void writeAuditLog({ userId: actor, action: command.action === 'cancel' ? 'cancel' : 'update', tableName: 'platform_mail', recordId: record.id, newValues: { event: observation.event, state: confirmed.state } });
    return json({ mail: confirmed });
  } catch { return serverError('platform-mail', new Error('MAIL_REQUEST_FAILED'), path); }
}

const getHandler = withRoute(list, { requireAuth: true, csrf: false,
  rateLimit: { limiter: null, limit: 40, windowMs: 60000, prefix: 'platform-mail-read' }, sentryTag: 'platform-mail' });
const postHandler = withRoute(post, { requireAuth: true, csrf: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60000, prefix: 'platform-mail-write' }, sentryTag: 'platform-mail' });
export async function GET(request: Request) { const response = await getHandler(request); response.headers.set('Cache-Control', 'no-store'); return response; }
export async function POST(request: Request) { const response = await postHandler(request); response.headers.set('Cache-Control', 'no-store'); return response; }
