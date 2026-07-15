/**
 * API エラーレスポンス（{ error, details: zod flatten() }）から、画面に出すメッセージを組み立てる
 * 純粋関数（admin/coupons new・edit で共有・2026年7月15日）。
 *
 * 【背景】admin API の 400 は `{ error: 'リクエストが不正です', details: parsed.error.flatten() }`
 * を返すが、旧実装の画面は err.error（汎用文言）だけを表示していたため、zod の具体メッセージ
 * （「定額割引は1円〜100,000円の範囲で入力してください」等）がユーザーに届かず、何を直せば
 * よいか分からなかった。details.fieldErrors の具体メッセージを優先して表示する。
 */

interface ApiErrorLike {
  error?: unknown;
  details?: {
    fieldErrors?: Record<string, unknown>;
  };
}

/**
 * fieldErrors の全メッセージ（string のみ）を「、」連結で返す。無ければ error 文字列、
 * それも無ければ fallback。
 */
export function formatApiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const e = err as ApiErrorLike;
  const fieldErrors = e.details?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const messages = Object.values(fieldErrors)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (messages.length > 0) return messages.join('、');
  }
  if (typeof e.error === 'string' && e.error.length > 0) return e.error;
  return fallback;
}
