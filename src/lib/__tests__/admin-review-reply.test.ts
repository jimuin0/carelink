/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync } from 'fs';
import { join } from 'path';
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
import {
  REVIEW_REPLY_FORBIDDEN, REVIEW_REPLY_INVALID,
  createReplyBody, createdReplyRow, deletedReplyRow, invalidReplyRequest, publicReply, replyFacilityId,
  replyRpcFailure, reviewReplyContent, sameId, singleReplyRow, updateReplyBody, updatedReplyRow,
} from '../admin-review-reply';
import { REVIEW_REPLY_LENGTH_MESSAGE, REVIEW_REPLY_MAX_LENGTH } from '../review-reply-limits';

const reply = '72000000-0000-4000-8000-000000000001';
const review = '72000000-0000-4000-8000-000000000002';
const facility = '72000000-0000-4000-8000-000000000003';
const row = { id: reply, review_id: review, content: 'ご来店ありがとうございました', created_at: '2026-10-22T00:00:00Z' };

beforeEach(() => mockAlert.mockReset());

describe('入力の検証', () => {
  test('本文は前後の空白を除いて 1〜500 文字（上限は画面・DB と同じ値）', () => {
    expect(REVIEW_REPLY_MAX_LENGTH).toBe(500);
    expect(reviewReplyContent.parse('  ありがとうございました  ')).toBe('ありがとうございました');
    expect(reviewReplyContent.safeParse('   ').success).toBe(false);
    expect(reviewReplyContent.safeParse('あ'.repeat(500)).success).toBe(true);
    expect(reviewReplyContent.safeParse('あ'.repeat(501)).success).toBe(false);
  });

  test('投稿は口コミ ID と本文、編集は本文だけを受け取る', () => {
    expect(createReplyBody.parse({ review_id: review, content: 'x', user_id: facility }))
      .toEqual({ review_id: review, content: 'x' });
    expect(createReplyBody.safeParse({ review_id: 'not-a-uuid', content: 'x' }).success).toBe(false);
    expect(updateReplyBody.parse({ content: 'y', review_id: review })).toEqual({ content: 'y' });
  });

  test.each([
    [`http://localhost/api/admin/review-replies?facility_id=${facility}`, facility],
    [`http://localhost/api/admin/review-replies?facility_id=${facility.toUpperCase()}`, facility.toUpperCase()],
    ['http://localhost/api/admin/review-replies', null],
    ['http://localhost/api/admin/review-replies?facility_id=bad', null],
  ])('店舗 ID は UUID だけを受け付ける（%s）', (url, expected) => {
    expect(replyFacilityId(new Request(url))).toBe(expected);
  });

  test('本文の不備は文字数の案内、それ以外は一般的な文言で 400', async () => {
    const content = invalidReplyRequest(updateReplyBody.safeParse({ content: '' }).error!);
    expect(content.status).toBe(400);
    expect(await content.json()).toEqual({ error: REVIEW_REPLY_LENGTH_MESSAGE });
    const other = invalidReplyRequest(createReplyBody.safeParse(null).error!);
    expect(other.status).toBe(400);
    expect(await other.json()).toEqual({ error: 'リクエストが不正です' });
  });
});

describe('RPC のエラーの扱い', () => {
  test.each([
    ['42501', REVIEW_REPLY_FORBIDDEN, 403, '店舗の管理権限を確認してください'],
    ['23505', 'duplicate key value violates unique constraint "review_replies_review_id_key"', 409,
      'この口コミには既に返信があります。画面を再読み込みしてください'],
    ['22023', REVIEW_REPLY_INVALID, 400, REVIEW_REPLY_LENGTH_MESSAGE],
  ])('%s（RPC が意図して投げたもの）は %i（通知しない）', async (code, message, status, userMessage) => {
    expect(message).not.toBe('');
    const res = replyRpcFailure({ code, message }, 'tag', '/route', '保存できませんでした');
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: userMessage });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test('照合する文言と SQLSTATE は migration の RPC が投げるものと同じ（片方だけ変えると 403/400 が 500 になる）', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261022140000_review_reply_edit_delete.sql'), 'utf8');
    expect(sql.split(`RAISE EXCEPTION '${REVIEW_REPLY_FORBIDDEN}' USING ERRCODE = '42501'`).length - 1).toBe(6);
    expect(sql.split(`RAISE EXCEPTION '${REVIEW_REPLY_INVALID}' USING ERRCODE = '22023'`).length - 1).toBe(2);
    // 接続先ガード（'not the CareLink database'）以外に、照合していない文言の例外が無い
    expect(sql.replace(/^DO \$guard\$.*$/m, '')).not.toMatch(/RAISE EXCEPTION '(?!REVIEW_REPLY_FORBIDDEN'|REVIEW_REPLY_INVALID')/);
  });

  test.each([
    // service_role の EXECUTE 権・表の権限が欠けた（設定ミス）。利用者の権限不足ではない。
    ['42501', 'permission denied for function create_review_reply_atomic'],
    ['42501', 'permission denied for table review_replies'],
    ['42501', undefined],
    // RPC 以外が出した 22023 は本文の不備ではない
    ['22023', 'invalid parameter'],
    ['57014', 'canceling statement due to statement timeout'],
    [undefined, 'private detail'],
  ])('想定外のエラー（%s: %s）は通知つきの 500 で、DB の詳細を返さない', async (code, message) => {
    const res = replyRpcFailure({ code, message }, 'tag', '/route', '保存できませんでした');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '保存できませんでした' });
    expect(mockAlert).toHaveBeenCalledWith('tag', expect.any(Error), '/route');
    expect(String(mockAlert.mock.calls[0][1].message)).not.toContain('permission denied');
    expect(String(mockAlert.mock.calls[0][1].message)).not.toContain('private detail');
  });
});

describe('RPC の結果を 1 行に確定する', () => {
  const matches = (r: { id: string }) => sameId(r.id, reply);

  test('0 行は対象なし（missing）', () => {
    expect(singleReplyRow(createdReplyRow, [], matches)).toBe('missing');
  });

  test('1 行で形と対象が一致すればその行', () => {
    expect(singleReplyRow(createdReplyRow, [row], matches)).toEqual(row);
    expect(singleReplyRow(createdReplyRow, [{ ...row, created_at: null }], matches)).toEqual({ ...row, created_at: null });
    expect(singleReplyRow(updatedReplyRow, [{ ...row, previous_content: '前の本文' }], matches))
      .toEqual({ ...row, previous_content: '前の本文' });
    expect(singleReplyRow(deletedReplyRow, [{ id: reply, review_id: review, content: '消した本文' }], matches))
      .toEqual({ id: reply, review_id: review, content: '消した本文' });
  });

  test.each([
    ['null', null],
    ['配列でない', row],
    ['複数行', [row, row]],
    ['形が違う', [{ ...row, id: 'bad' }]],
    ['別の返信', [{ ...row, id: facility }]],
  ])('%s は確認できない（null）', (_label, data) => {
    expect(singleReplyRow(createdReplyRow, data, matches)).toBeNull();
  });

  test('UUID は大文字小文字を区別しない', () => {
    expect(sameId(reply.toUpperCase(), reply)).toBe(true);
    expect(sameId(reply, review)).toBe(false);
  });

  test('画面に返すのは id・review_id・本文・投稿日だけ', () => {
    expect(publicReply({ ...row, previous_content: '前の本文' } as typeof row)).toEqual(row);
  });
});
