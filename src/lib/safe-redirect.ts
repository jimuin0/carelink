/**
 * ログイン／登録後の戻り先（?redirect）を安全に解決する単一ソース。
 *
 * 🔴 なぜ集約するか（2026年8月20日・実測で判明した実害）
 * 従来は `raw.startsWith('/') && !raw.startsWith('//')` という判定が
 * `/auth/login` `/auth/signup` `/auth/callback` に個別にコピーされていた。
 * この判定は **`/\evil.com` を通してしまう**。URL パーサ（Node もブラウザも）は
 * 特殊スキームの下でバックスラッシュを `/` に正規化するため：
 *
 *   '/\\evil.com'.startsWith('//')                        → false（ガードを素通り）
 *   new URL('/\\evil.com', 'https://carelink-jp.com').href → 'https://evil.com/'
 *
 * そして Next 16.3.0 の App Router は、まさにこのパーサ形で href を解決してから
 * 外部判定を行う（`app-router-instance.js` の `new URL(addBasePath(href), location.href)`
 * → `isExternalURL`（origin 比較）→ `completeHardNavigation`）。つまり
 * `router.push('/\\evil.com')` は**外部サイトへ実際に遷移する**＝オープンリダイレクト。
 *
 * 文字列の形（先頭が `/` か、`//` でないか）で判定する限り、パーサの正規化規則を
 * 追いかけ続けることになり、次に見つかる別表記（`/\/`、制御文字混じり等）を守れない。
 * **解決した結果の origin を比較する**のが唯一の正しい判定なので、それをここに集約する。
 *
 * ⚠️ `/auth/callback/route.ts` の `` `${origin}${redirect}` `` という**文字列連結**は、
 * 実は外部へ出ない（`https://carelink-jp.com` + `/\evil.com` は
 * `https://carelink-jp.com//evil.com` に正規化される）。危険なのは
 * 「解決してからナビゲートする」経路＝`router.push` / `router.replace` の方。
 * ただし判定を1本に揃えるため callback もこのヘルパーを使ってよい（挙動は変わらない）。
 */

/** redirect 未指定・不正時の既定の戻り先。予約者向けマイページ。 */
export const DEFAULT_REDIRECT = '/mypage';

/**
 * `?redirect` の生値を、同一オリジンに解決されるパスだけに絞り込む。
 *
 * @param raw     クエリから取り出した生の値（null/undefined 可）
 * @param origin  現在のオリジン。サーバーでは `request.nextUrl.origin`、
 *                ブラウザでは `window.location.origin` を渡す。
 * @returns 安全なパス（`pathname + search + hash`）。危険・不正なら {@link DEFAULT_REDIRECT}。
 */
export function safeRedirect(raw: string | null | undefined, origin: string): string {
  if (!raw || !raw.startsWith('/')) return DEFAULT_REDIRECT;
  try {
    const resolved = new URL(raw, origin);
    // 🔴 ここが本質。文字列の形ではなく「解決後にどこへ行くか」で判定する。
    if (resolved.origin !== new URL(origin).origin) return DEFAULT_REDIRECT;
    // 🔴 解決後の pathname が `//` で始まると、返したパスを router.push が
    // プロトコル相対 URL（`//evil.com` → https://evil.com/）として解釈し外部へ出る。
    // 入力 `/.//evil.com`・`/a/..//evil.com`・`/%2e//evil.com` は origin 比較を通るが
    // ドット区間の除去後に pathname が `//evil.com` になる（2026年11月13日 点検で判明）。
    // 返す値そのものを同じパーサで解き直し、同一オリジンに留まることまで確かめる。
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (path.startsWith('//') || new URL(path, origin).origin !== new URL(origin).origin) return DEFAULT_REDIRECT;
    return path;
  } catch {
    // 解析不能な値（不正なパーセントエンコード等）は既定へ倒す。
    return DEFAULT_REDIRECT;
  }
}
