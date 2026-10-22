/**
 * 口コミへの店舗返信（公開・編集・削除）の API 共通部品（2026年10月22日 新設）。
 *
 * 書き込みは /api/admin/review-replies（POST）と /api/admin/review-replies/[id]（PATCH・DELETE）
 * から、service_role 専用の RPC（create / update / delete_review_reply_atomic）だけで行う。
 * RPC の中で「今もその店舗の owner / admin か」を行ロックつきで確かめ直し、口コミ・返信が
 * その店舗のものでなければ 0 行を返す。ブラウザから review_replies へ直接書く権限は無い
 * （supabase/migrations/20261022140000_review_reply_edit_delete.sql）。
 *
 * route.ts はメソッド以外を export できないため、2 本のルートで共有する部品はここに置く。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_REGEX } from './constants';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import { REVIEW_REPLY_LENGTH_MESSAGE, REVIEW_REPLY_MAX_LENGTH } from './review-reply-limits';

const uuid = z.string().regex(UUID_REGEX);

/** 前後の空白は取り除いてから数える（空白だけの返信は公開しない）。 */
export const reviewReplyContent = z.string().trim().min(1).max(REVIEW_REPLY_MAX_LENGTH);

export const createReplyBody = z.object({ review_id: uuid, content: reviewReplyContent });
export const updateReplyBody = z.object({ content: reviewReplyContent });

const replyRow = z.object({
  id: uuid, review_id: uuid, content: z.string(), created_at: z.string().nullable(),
});
export const createdReplyRow = replyRow;
export const updatedReplyRow = replyRow.extend({ previous_content: z.string() });
export const deletedReplyRow = z.object({ id: uuid, review_id: uuid, content: z.string() });

export type AdminReviewReply = z.infer<typeof replyRow>;

/** 店舗 ID（クエリの facility_id）。不正なら null。 */
export function replyFacilityId(request: Request): string | null {
  const facilityId = new URL(request.url).searchParams.get('facility_id');
  return facilityId && UUID_REGEX.test(facilityId) ? facilityId : null;
}

/** 入力の不備。本文の不備は文字数の案内を出し、それ以外（ID の不正等）は一般的な文言にする。 */
export function invalidReplyRequest(error: z.ZodError): NextResponse {
  const contentIssue = error.issues.some((issue) => issue.path[0] === 'content');
  return NextResponse.json(
    { error: contentIssue ? REVIEW_REPLY_LENGTH_MESSAGE : 'リクエストが不正です' },
    { status: 400 },
  );
}

/**
 * RPC のエラーを応答に変える。
 * 42501＝今はその店舗の owner / admin ではない、23505＝その口コミには既に返信がある
 * （UNIQUE(review_id)）、22023＝本文が空・上限超え。それ以外は通知つきの 500。
 */
export function replyRpcFailure(
  error: { code?: string }, tag: string, route: string, userMessage: string,
): NextResponse {
  if (error.code === '42501') {
    return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
  }
  if (error.code === '23505') {
    return NextResponse.json(
      { error: 'この口コミには既に返信があります。画面を再読み込みしてください' }, { status: 409 },
    );
  }
  if (error.code === '22023') {
    return NextResponse.json({ error: REVIEW_REPLY_LENGTH_MESSAGE }, { status: 400 });
  }
  return serverError(tag, databaseDiagnostic(error), route, userMessage);
}

/**
 * RPC の結果を 1 行に確定する。
 * 0 行＝対象がその店舗に無い（'missing'）。1 行で形と対象が一致すればその行。
 * それ以外（複数行・形の不一致・別の対象）は確認できないので null（呼び出し側で 500）。
 */
export function singleReplyRow<T>(
  schema: z.ZodType<T>, data: unknown, matches: (row: T) => boolean,
): T | 'missing' | null {
  if (Array.isArray(data) && data.length === 0) return 'missing';
  if (!Array.isArray(data) || data.length !== 1) return null;
  const parsed = schema.safeParse(data[0]);
  return parsed.success && matches(parsed.data) ? parsed.data : null;
}

/** UUID は大文字小文字を区別せずに比べる（DB は小文字で返す）。 */
export function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 画面に返す形（監査用の previous_content などは含めない）。 */
export function publicReply(row: AdminReviewReply): AdminReviewReply {
  return { id: row.id, review_id: row.review_id, content: row.content, created_at: row.created_at };
}
