import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

/**
 * Zod 検証失敗を「どのフィールドが原因か分かる」400 レスポンスに変換する（監査F2/F3の根治）。
 *
 * 従来は `{ error: 'リクエストが不正です' }` の汎用文言のみで、氏名/メール/電話番号/日付の
 * どれが原因でもユーザーに伝わらず離脱要因になっていた。最初のフィールドエラーメッセージを
 * 先頭 `error` に載せ（フロントがそのまま表示可能）、構造化した `details` も併せて返す。
 */
export function zodErrorResponse(error: ZodError, status = 400) {
  const flat = error.flatten();
  const firstFieldMsg = Object.values(flat.fieldErrors)
    .flat()
    .find((m): m is string => typeof m === 'string' && m.length > 0);
  const message = firstFieldMsg || flat.formErrors[0] || '入力内容を確認してください';
  return NextResponse.json({ error: message, details: flat }, { status });
}
