import { NextResponse } from 'next/server';
import { UUID_REGEX } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError, withRoute } from '@/lib/with-route';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import {
  deletedReplyRow, invalidReplyRequest, publicReply, replyFacilityId, replyRpcFailure, sameId,
  singleReplyRow, updateReplyBody, updatedReplyRow,
} from '@/lib/admin-review-reply';

const ROUTE = '/api/admin/review-replies/[id]';
const OPTIONS = {
  requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-review-replies' },
  sentryTag: 'admin-review-replies',
};
const notFound = () => NextResponse.json(
  { error: 'この返信は見つかりません。画面を再読み込みしてください' }, { status: 404 },
);

type Props = { params: Promise<{ id: string }> };

/** 返信の本文を書き換える（書き換えるのは本文だけ。口コミ・最初の投稿者・投稿日は変えない）。 */
export async function PATCH(request: Request, props: Props) {
  return withRoute(async (req, ctx) => {
    const { id } = await props.params;
    const facilityId = replyFacilityId(req);
    if (!facilityId || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: '店舗・返信IDが不正です' }, { status: 400 });
    }
    const parsed = updateReplyBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalidReplyRequest(parsed.error);

    const { data, error } = await createServiceRoleClient().rpc('update_review_reply_atomic', {
      p_actor_id: ctx.user!.id, p_facility_id: facilityId, p_reply_id: id, p_content: parsed.data.content,
    });
    if (error) return replyRpcFailure(error, 'admin-review-replies-update', ROUTE, '返信を更新できませんでした');
    const row = singleReplyRow(updatedReplyRow, data, (r) => sameId(r.id, id));
    if (row === 'missing') return notFound();
    if (row === null) {
      return serverError('admin-review-replies-update-result', new Error('REVIEW_REPLY_RESULT_INVALID'), ROUTE,
        '返信の更新を確認できませんでした。画面を再読み込みしてください');
    }

    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({
      userId: ctx.user!.id, facilityId, action: 'update', tableName: 'review_replies', recordId: row.id,
      oldValues: { content: row.previous_content }, newValues: { content: row.content },
      ipAddress: ip, userAgent: ua,
    });
    return NextResponse.json({ reply: publicReply(row) });
  }, OPTIONS)(request);
}

/** 返信を削除する。店舗ページは返信を都度読むので、削除した時点で表示されなくなる。 */
export async function DELETE(request: Request, props: Props) {
  return withRoute(async (req, ctx) => {
    const { id } = await props.params;
    const facilityId = replyFacilityId(req);
    if (!facilityId || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: '店舗・返信IDが不正です' }, { status: 400 });
    }

    const { data, error } = await createServiceRoleClient().rpc('delete_review_reply_atomic', {
      p_actor_id: ctx.user!.id, p_facility_id: facilityId, p_reply_id: id,
    });
    if (error) return replyRpcFailure(error, 'admin-review-replies-delete', ROUTE, '返信を削除できませんでした');
    const row = singleReplyRow(deletedReplyRow, data, (r) => sameId(r.id, id));
    if (row === 'missing') return notFound();
    if (row === null) {
      return serverError('admin-review-replies-delete-result', new Error('REVIEW_REPLY_RESULT_INVALID'), ROUTE,
        '返信の削除を確認できませんでした。画面を再読み込みしてください');
    }

    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({
      userId: ctx.user!.id, facilityId, action: 'delete', tableName: 'review_replies', recordId: row.id,
      oldValues: { review_id: row.review_id, content: row.content }, ipAddress: ip, userAgent: ua,
    });
    return NextResponse.json({ ok: true, replyId: row.id });
  }, OPTIONS)(request);
}
