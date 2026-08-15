/**
 * Resend SDK の戻り値を検査して、API エラーなら例外にする。
 *
 * 🔴 why（SDK の一次情報で確認・2026年8月14日）:
 *   Resend SDK は API エラーを **throw しない**。`node_modules/resend/dist/index.mjs` の
 *   `fetchRequest` は
 *     - `!response.ok`（401/422/429 等）→ `{ data: null, error: <APIのJSON> }` を **resolve**
 *     - ネットワーク断（内部の catch）→ `{ data: null, error: { name:'application_error', … } }` を **resolve**
 *   と、どちらも正常終了として返す。したがって
 *
 *       try { await resend.emails.send(...); delivered = true } catch { … }
 *
 *   と書くと、**1 通も送れていないのに必ず `delivered = true` になる**。catch には永遠に入らない。
 *
 *   この形は 2026年7月8日に `src/lib/email.ts` の `safeSend` で一度根治されているが、
 *   そこを通らずに `resend.emails.send` / `resend.batch.send` を直接呼ぶ経路が
 *   ニュースレター手動配信と cron 5 本に残っていた（＝同じ欠陥が別の場所で生きていた）。
 *
 * when（失敗時の挙動）:
 *   error があれば Error を throw する。呼び出し側は既に try/catch を持っており、
 *   「throw されたら失敗」という前提で失敗計上・リトライ登録を書いているので、
 *   throw に変換するだけでその既存処理が**初めて正しく動く**ようになる。
 *   error が無ければ何もしない（戻り値なし＝呼び出し側の分岐を増やさない）。
 *
 * 再発検知は `src/__tests__/resend-result-checked-guard.test.ts`。
 */

/** Resend の `{ data, error }` 応答のうち、判定に使う部分だけを表す。 */
type ResendErrorShape = {
  statusCode?: number | null;
  name?: string;
  message?: string;
};

/**
 * Resend の応答から人が読める失敗理由を組み立てる。
 * ログと Slack にそのまま出るので、原因の切り分けに要る 3 点（HTTP・種別・本文）を必ず含める。
 */
export function describeResendError(error: unknown): string {
  const e = (error ?? {}) as ResendErrorShape;
  const parts = [
    e.statusCode == null ? '' : String(e.statusCode),
    e.name ?? '',
    e.message ?? '',
  ].filter((s) => s !== '');
  // 既知の形に当てはまらない場合でも、原文を落とさない（握り潰すと調査不能になる）。
  return parts.length > 0 ? parts.join(' ') : JSON.stringify(error);
}

/**
 * Resend の戻り値に error が載っていたら throw する。
 *
 * @param result Resend SDK の戻り値（`{ data, error }`）
 * @param context どの送信かをログで特定するための文字列（例: 'cron/review-request'）
 */
export function throwIfResendError(result: unknown, context: string): void {
  const error = (result as { error?: unknown } | null | undefined)?.error;
  if (!error) return;
  throw new Error(`resend send failed [${context}]: ${describeResendError(error)}`);
}

/**
 * Resend の送信呼び出しを実行し、戻り値を必ず検査してから返す。
 *
 * 🔴 why（2026年8月14日 新設・`resend-result-checked-guard.test.ts` の抜け穴を塞ぐための唯一の正しい入口）:
 *   `const r = await resend.emails.send(...)` のように結果を変数へ受けてから
 *   `throwIfResendError(r, ...)` を呼ぶ形は、**呼び出しを書いたあと検査の行だけを
 *   書き忘れる／消す**ことが構文的に可能で、その状態でも見た目上は正しいコードに見える
 *   （実測: 既存 7 箇所から `throwIfResendError` の行を消してもガードが検出できなかった）。
 *   `resend.emails.send(...)` / `resend.batch.send(...)` を直接 await せず、必ずこの関数の
 *   **引数の位置**で呼び出すことにすれば、「送ったが検査していない」状態がそもそも
 *   書けなくなる（await はこの関数の中で行うため、呼び出し側は await しない）。
 *
 * when（失敗時の挙動）: `throwIfResendError` と同じ（error があれば throw）。
 *
 * @param sendCall `resend.emails.send(...)` / `resend.batch.send(...)` の戻り値（Promise）。
 *   ⚠️ 呼び出し側でこれを await しないこと（`await sendResendChecked(resend.emails.send(...), ctx)`
 *   のように、send 呼び出し自体をそのままこの引数に渡す）。
 * @param context throwIfResendError と同じ用途のログ識別子。
 * @returns error が無かった場合の Resend の戻り値（呼び出し側が data を使う場合のため）。
 */
export async function sendResendChecked<T extends { error?: unknown }>(
  sendCall: Promise<T>,
  context: string
): Promise<T> {
  const result = await sendCall;
  throwIfResendError(result, context);
  return result;
}
