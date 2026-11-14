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
    const baseRow = registrationListRow.omit({ classification: true, classification_revision: true, hidden: true, approval_notice: true, documents_deferred: true })
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
    // approval_sent（Slack の「送信しました」）は、メールが送信できた後にだけ積まれる。メールのジョブの状態を
    // 更新できずに残っていても、こちらがあれば送信済みとして扱う（Slack と一覧の表示を食い違わせない）。
    // 一意の索引と同じ template_version=1 で絞る（版を足したときに同じ申込の行が重複しないように）。
    // 申込ごとのジョブは種類ごとに 1 件（受付・受付の Slack・承認・承認の Slack）まで。
    const notices = page.length === 0 ? { data: [], error: null } : await db.from('webhook_retry_queue')
      .select('registration_id,notification_kind,status,delivery_started_at').eq('template_version', 1)
      .in('registration_id', page.map(row => row.id));
    const parsedNotices = z.array(z.object({ registration_id: z.uuid(), notification_kind: z.enum(['receipt', 'internal', 'approval', 'approval_sent']), status: z.enum(['pending', 'processing', 'success', 'failed', 'cancelled']), delivery_started_at: z.string().nullable() }).strict())
      .max(200).safeParse(notices.data);
    if (notices.error !== null || !parsedNotices.success) return { state: 'unavailable' as const };
    const approvalNotices = parsedNotices.data.filter(notice => notice.notification_kind === 'approval');
    const noticeIndex = new Map(approvalNotices.map(notice => [notice.registration_id, notice]));
    if (noticeIndex.size !== approvalNotices.length) return { state: 'unavailable' as const };
    const sentIds = new Set(parsedNotices.data.filter(notice => notice.notification_kind === 'approval_sent').map(notice => notice.registration_id));
    // 送信を始めた後に結果が分からなくなったジョブは、webhook-retry が自動の再送から外して processing のまま残す
    // （送れている可能性がある）。「送信待ち」とは書かず、送れたか確認が要る状態として出す。
    // cancelled は、送り始める前に承認が取り消されて止めたもの（送っていない）。
    const noticeState = (id: string) => {
      const notice = noticeIndex.get(id);
      if (sentIds.has(id) || notice?.status === 'success') return 'sent' as const;
      if (notice === undefined || notice.status === 'cancelled') return 'none' as const;
      if (notice.status === 'processing' && notice.delivery_started_at !== null) return 'uncertain' as const;
      return notice.status === 'pending' || notice.status === 'processing' ? 'queued' as const : 'failed' as const;
    };
    // 「書類は後から」の印（2026-11-03 本人決定）。
    const deferrals = page.length === 0 ? { data: [], error: null } : await db.from('listing_verification_deferrals')
      .select('salon_id,deferred').in('salon_id', page.map(row => row.id));
    const parsedDeferrals = z.array(z.object({ salon_id: z.uuid(), deferred: z.boolean() }).strict()).max(50).safeParse(deferrals.data);
    if (deferrals.error !== null || !parsedDeferrals.success) return { state: 'unavailable' as const };
    const deferredIds = new Set(parsedDeferrals.data.filter(row => row.deferred).map(row => row.salon_id));
    const salons = page.map(row => ({ ...row, classification: index.get(row.id)?.classification ?? null,
      classification_revision: index.get(row.id)?.revision ?? 0, hidden: hiddenOnly,
      approval_notice: noticeState(row.id), documents_deferred: deferredIds.has(row.id) }));
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
