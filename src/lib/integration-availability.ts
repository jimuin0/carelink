/**
 * 任意設定の外部連携が「このデプロイで実際に使えるか」を判定する単一の入口。
 *
 * 【背景・2026年7月30日 本番実測】
 * 本番の環境変数を確認したところ、コードは完成しているのに鍵が入っていない連携が複数あり、
 * それでも UI は機能があるかのように見せていた。客と施設が実際に踏んで失敗する状態だった。
 *   - ANTHROPIC_API_KEY 未設定：全ページ右下の AI チャットボットが 503
 *     （POST /api/chat → {"error":"AIサービスに接続できませんでした"}）。
 *     トップからリンクしている AI 症状チェッカーも 500
 *     （POST /api/symptoms/suggest → {"error":"AI処理に失敗しました"}）。
 *   - STRIPE_SECRET_KEY 未設定：施設の管理画面に ¥500〜¥1,500/月 の有料オプションが
 *     値札と購入ボタン付きで並ぶが、押すと 503「決済機能が設定されていません」。
 *   - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 未設定：マイページに
 *     「Googleカレンダーと連携する」ボタンが出るが連携できない。
 *
 * 【なぜ手動フラグにしないか＝真の予防】
 * `LAUNCH_HIDDEN = true` のような定数で隠すと、後で鍵を入れたときに戻し忘れて
 * 「設定したのに出ない」、フラグだけ戻して「出るのに動かない」の両方が起きる。
 * どちらも「表示」と「実際に使えるか」が別管理であることが原因なので、表示を設定に従属させる。
 * 神原さんが Vercel に鍵を入れた瞬間に該当機能が自動で復活し、コード変更は要らない。
 * LINE を LIFF ID の有無で出し分ける [lib/line-availability.ts] と同じ設計。
 *
 * 【サーバ専用】ここで読むのはすべて NEXT_PUBLIC_ が付かないサーバ側の変数のため、
 * クライアントコンポーネントから直接呼んではならない（常に false になる）。
 * サーバコンポーネントか Route Handler で評価し、真偽値を props / レスポンスで渡すこと。
 */

/** AI 機能（チャットボット・症状チェッカー・レビュー要約・AIサポート）が使えるか。 */
export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * 有料オプションを購入できるか。
 * 決済セッションを作るのは /api/options/checkout で、そこが見るのは STRIPE_SECRET_KEY。
 * 判定を同じ変数に揃えることで「表示できるのに購入は 503」というズレが構造的に起きなくなる。
 */
export function isPaymentsEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Google カレンダー連携（OAuth）が使えるか。両方揃って初めて OAuth が成立する。 */
export function isGoogleCalendarEnabled(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * 広告枠（featured-ads）を PAY.JP の月額サブスクで販売できるか（2026年11月13日・点検 B2-1）。
 * 秘密鍵・webhook の照合トークン・公開鍵（カード入力の payjp.js 用）・プラン ID の 4 つが揃って初めて
 * 「申込 → 課金 → webhook で有効化」が成立する。1 つでも欠ければ販売 UI も API も出さない
 * （販売停止中と同じ見え方）。NEXT_PUBLIC_PAYJP_PUBLIC_KEY はビルド時に埋め込まれる公開値。
 */
export function isPayjpEnabled(): boolean {
  return !!(process.env.PAYJP_SECRET_KEY && process.env.PAYJP_WEBHOOK_TOKEN
    && process.env.NEXT_PUBLIC_PAYJP_PUBLIC_KEY && process.env.PAYJP_FEATURED_PLAN_ID);
}
