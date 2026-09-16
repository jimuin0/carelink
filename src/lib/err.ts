/**
 * unknown なエラー値から表示用メッセージを安全に取り出す共有ヘルパ。
 * Supabase の PostgrestError（Error インスタンスではないが message を持つ）/ 素の Error /
 * それ以外（文字列・null 等）を一様に文字列化する。各所で
 * `(e as {message?:string})?.message ?? String(e)` を inline すると分岐が散在し
 * テストが重複するため、ここに集約して一度だけ網羅テストする。
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

/**
 * Supabase の到達障害（Cloudflare が返す 522 を含む）かを判定する。
 *
 * PostgREST が Cloudflare の HTML エラーページを message に載せることがある。この本文には
 * infrastructure の診断情報が含まれ得るため、通知・cron_logs には生の本文を流さない。
 * 読取だけを一度再試行するかどうかの判定にも使う。
 */
export function isTransientSupabaseError(e: unknown): boolean {
  return /(?:supabase\.co\s*\|\s*522|error\s*code\s*522|cloudflare[^\n]*522|connection timed out[^\n]*supabase|supabase[^\n]*connection timed out)/i.test(errorMessage(e));
}

/** 通知・運用ログ用に依存サービスのエラーを短く安全な文面へ正規化する。 */
export function summarizeDependencyError(e: unknown): string {
  const message = errorMessage(e);
  if (isTransientSupabaseError(message)) return 'Supabase 接続障害（Cloudflare 522）';
  if (/<(?:!doctype|html)\b/i.test(message)) return '依存サービスが HTML エラーページを返しました';
  return message.length > 240 ? `${message.slice(0, 239)}…` : message;
}

/**
 * 読取専用の Supabase 呼び出しだけを、522 のときに一度だけ再試行する。
 *
 * 書込み・送信をここへ渡さない。二重処理を防ぐため、再試行対象を副作用のない read に限定する。
 */
export async function retryTransientSupabaseRead<T extends { error: unknown | null }>(
  read: () => PromiseLike<T>,
): Promise<T> {
  const first = await read();
  return isTransientSupabaseError(first.error) ? read() : first;
}
