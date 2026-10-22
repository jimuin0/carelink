import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError, withRoute } from '@/lib/with-route';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import {
  createReplyBody, createdReplyRow, invalidReplyRequest, publicReply, replyFacilityId, replyRpcFailure,
  sameId, singleReplyRow,
} from '@/lib/admin-review-reply';

const ROUTE = '/api/admin/review-replies';

/**
 * 口コミへの返信を公開する（1 口コミにつき 1 件）。
 * 権限（その店舗の owner / admin か）と口コミの所属は RPC が書き込みと同じトランザクションで確かめる。
 */
export const POST = withRoute(async (req, ctx) => {
  const facilityId = replyFacilityId(req);
  if (!facilityId) return NextResponse.json({ error: '店舗IDが不正です' }, { status: 400 });
  const parsed = createReplyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidReplyRequest(parsed.error);

  const { data, error } = await createServiceRoleClient().rpc('create_review_reply_atomic', {
    p_actor_id: ctx.user!.id, p_facility_id: facilityId,
    p_review_id: parsed.data.review_id, p_content: parsed.data.content,
  });
  if (error) return replyRpcFailure(error, 'admin-review-replies-create', ROUTE, '返信を公開できませんでした');
  const row = singleReplyRow(createdReplyRow, data, (r) => sameId(r.review_id, parsed.data.review_id));
  if (row === 'missing') {
    return NextResponse.json({ error: 'この店舗の口コミが見つかりません。画面を再読み込みしてください' }, { status: 404 });
  }
  if (row === null) {
    return serverError('admin-review-replies-create-result', new Error('REVIEW_REPLY_RESULT_INVALID'), ROUTE,
      '返信の公開を確認できませんでした。画面を再読み込みしてください');
  }

  const { ip, ua } = getRequestContext(req);
  void writeAuditLog({
    userId: ctx.user!.id, facilityId, action: 'create', tableName: 'review_replies', recordId: row.id,
    newValues: { review_id: row.review_id, content: row.content }, ipAddress: ip, userAgent: ua,
  });
  return NextResponse.json({ reply: publicReply(row) }, { status: 201 });
}, {
  requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-review-replies' },
  sentryTag: 'admin-review-replies',
});
