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
