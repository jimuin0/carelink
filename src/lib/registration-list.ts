import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { registrationListInput, registrationListRow, registrationCursorFilter, type RegistrationCursor } from './registration-list-contract';

export async function readRegistrationList(db: ReturnType<typeof createServiceRoleClient>, value: unknown) {
  const parsed = registrationListInput.safeParse(value);
  if (!parsed.success) return { state: 'invalid' as const };
  const input = parsed.data;
  try {
    const hiddenOnly = input.visibility === 'hidden';
    // 隠した申込の判定は DB 側で行う（取得後に除くと 50 件ずつのページ送りがずれる）。
    // 'hidden' は隠した行だけ（!inner）、既定は「隠した印が付いていない」行だけ（印の embed が NULL）。
    let query = db.from('salons')
      .select(hiddenOnly
        ? 'id,name:facility_name,email,phone,source,status,created_at,claimed_at,claimed_facility_id,review_revision,hidden_mark:salon_registration_visibility!inner(hidden)'
        : 'id,name:facility_name,email,phone,source,status,created_at,claimed_at,claimed_facility_id,review_revision,hidden_mark:salon_registration_visibility(hidden)')
      .eq('hidden_mark.hidden', true)
      .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
    if (!hiddenOnly) query = query.is('hidden_mark', null);
    if (input.query) {
      const column = { receipt: 'id', facility: 'facility_name', email: 'email' }[input.field];
      query = query.eq(column, input.field === 'receipt' ? input.query.toLowerCase() : input.query);
    }
    if (input.status === 'unknown') query = query.is('status', null);
    else if (input.status !== 'all') query = query.eq('status', input.status);
    if (input.cursor) query = query.or(registrationCursorFilter(input.cursor));
    const result = await query.limit(51);
    // 印が条件どおりでない行が 1 件でも返れば、取りこぼしを疑って一覧ごと失敗にする。
    const baseRow = registrationListRow.omit({ classification: true, classification_revision: true, hidden: true, approval_notice: true })
      .extend({ hidden_mark: hiddenOnly ? z.object({ hidden: z.literal(true) }).strict() : z.null() });
    const rows = z.array(baseRow).max(51).safeParse(result.data);
    if (result.error !== null || !rows.success) return { state: 'unavailable' as const };
    const page = rows.data.slice(0, 50).map(({ hidden_mark: _mark, ...row }) => row);
    const labels = page.length === 0 ? { data: [], error: null } : await db.from('salon_registration_classifications')
      .select('salon_id,classification,revision').in('salon_id', page.map(row => row.id));
    const parsedLabels = z.array(z.object({ salon_id: z.uuid(), classification: z.enum(['test', 'real', 'unknown']), revision: z.number().int().positive() }).strict()).max(50).safeParse(labels.data);
    if (labels.error !== null || !parsedLabels.success) return { state: 'unavailable' as const };
    const index = new Map(parsedLabels.data.map(label => [label.salon_id, label]));
    if (index.size !== parsedLabels.data.length) return { state: 'unavailable' as const };
    // 承認のお知らせメールの送信状況（通知の待ち行列の approval ジョブ）。一覧に「送ったか」を推測で書かないため。
    const notices = page.length === 0 ? { data: [], error: null } : await db.from('webhook_retry_queue')
      .select('registration_id,status').eq('notification_kind', 'approval').in('registration_id', page.map(row => row.id));
    const parsedNotices = z.array(z.object({ registration_id: z.uuid(), status: z.enum(['pending', 'processing', 'success', 'failed', 'cancelled']) }).strict())
      .max(50).safeParse(notices.data);
    if (notices.error !== null || !parsedNotices.success) return { state: 'unavailable' as const };
    const noticeIndex = new Map(parsedNotices.data.map(notice => [notice.registration_id, notice.status]));
    if (noticeIndex.size !== parsedNotices.data.length) return { state: 'unavailable' as const };
    const noticeState = (status: string | undefined) => status === undefined ? 'none' as const
      : status === 'success' ? 'sent' as const : status === 'pending' || status === 'processing' ? 'queued' as const : 'failed' as const;
    const salons = page.map(row => ({ ...row, classification: index.get(row.id)?.classification ?? null,
      classification_revision: index.get(row.id)?.revision ?? 0, hidden: hiddenOnly,
      approval_notice: noticeState(noticeIndex.get(row.id)) }));
    let nextCursor: RegistrationCursor | null = null;
    if (rows.data.length > 50) {
      const last = salons[salons.length - 1];
      nextCursor = { id: last.id, createdAt: last.created_at };
    }
    return { state: 'confirmed' as const, salons, nextCursor };
  } catch {
    return { state: 'unavailable' as const };
  }
}
