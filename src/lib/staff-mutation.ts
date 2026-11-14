import { NextResponse } from 'next/server';
import { serverError } from './with-route';

/** Only expected database business errors become 4xx. Database/network failures
 * stay visible 5xx; no compensating writes run after an uncertain RPC result. */
export function staffMutationError(error: { code?: string; message: string }, tag: string, route: string) {
  // 42501 は「認証済みだがこの施設の権限が無い」。再ログインでは解決しないので 401 ではなく 403（低 A247）。
  if (error.code === '42501') return NextResponse.json({ error: 'この施設のスタッフを変更する権限がありません。' }, { status: 403 });
  if (error.message === 'STAFF_NOT_FOUND') return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 404 });
  if (error.message === 'STAFF_OPERATION_CONFLICT' || error.message === 'STAFF_OPERATION_RETIRED') {
    return NextResponse.json({ error: '前回の保存と内容が異なります。スタッフ一覧で保存結果を確認してください。', code: error.message }, { status: 409 });
  }
  if (error.message === 'STAFF_INPUT_INVALID') return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  return serverError(tag, error, route);
}
