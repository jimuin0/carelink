/**
 * React Compiler 系 react-hooks ルールの「返済ラチェット」の純粋ロジック。
 *
 * 🔴 なぜ必要か: eslint.config.mjs でこれらのルールを警告に落としている。警告は CI を
 * 落とさないので、普通は誰も見ないまま増え続ける。増加を物理的に止め、かつベースラインの
 * 数字が実態から乖離しないようにするための機構。
 *
 * 判定は【厳密一致】にしてある。増えたら退行として落ちるのは当然として、【減っても落とす】。
 * 「以下ならOK」にするとベースラインが実態より大きいまま放置され、次に増えたときに
 * 検知できる余地をその分だけ失うため（ラチェットが緩む）。減った場合はベースラインを
 * その値へ更新することが返済作業の一部。
 *
 * ⚠️ eslint の実行そのものはここでは行わない（純粋関数だけを置き、テストから決定的に
 * 検証できるようにするため）。実行は scripts/check-react-compiler-debt.mjs が担う。
 */

/**
 * ラチェットの対象ルール＝【意図的に直さないと決めた警告】の集合。
 *
 * 前半4つは eslint.config.mjs で warn に落としている React Compiler 系。
 * 後半2つは warn のままだが「直せない／直してはいけない」と結論した分で、
 * 監視外に置くと同種の警告が黙って増えるためここで数える。
 *
 * ⚠️ ここに足すのは【個別に検証して直さないと決めたもの】だけにすること。
 * 「直すのが面倒だから足す」を許すと、ラチェットは負債を隠す道具に変わる。
 */
export const RATCHET_RULES = [
  'react-hooks/set-state-in-effect',
  'react-hooks/purity',
  'react-hooks/immutability',
  'react-hooks/refs',
  // React Compiler が「互換性のないライブラリ」としてコンパイルを諦めた箇所（3件）。
  // recruit / register / ReviewForm。原因は react-hook-form の useForm() が返す watch() で、
  // 「安全にメモ化できない関数を返す」ため。ライブラリ側の都合なので、こちらのコードを
  // 歪めて回避すべきではない（上流が対応したら自然に消える）。
  //
  // 🔴 そもそも React Compiler はこのプロジェクトで有効になっていない（2026年8月16日 実測：
  // next.config.mjs に reactCompiler の指定なし・babel-plugin-react-compiler は依存にも
  // node_modules にも存在しない）。つまりこの3件は【動いていない最適化がスキップされた】
  // という報告であり、現時点で実行時への影響はゼロ。将来 React Compiler を有効化するときに
  // 「この3コンポーネントは自動メモ化されない」ことを知る手がかりとして数え続ける。
  'react-hooks/incompatible-library',
  // 退会成功後の window.location.href='/' （2件・mypage/profile と WithdrawalSettings）。
  // router.push へ置き換えてはいけない。Supabase セッション・middleware の admin membership
  // 署名 Cookie・アプリ内 state を確実に破棄するために全リロードが要る。
  '@next/next/no-location-assign-relative-destination',
];

/**
 * 現在の負債件数。2026年8月18日 に eslint-config-next 16.3.0 / React 19 / react-hook-form 7.85 で
 * 実測した値。返済したらこの数を下げること（下げ忘れは checkDebt が検知する）。
 *
 * 内訳（6 件）:
 *   incompatible-library 3 件 … recruit / register / ReviewForm。react-hook-form の watch()。
 *   no-location-assign   2 件 … 退会後の全リロード（mypage/profile と WithdrawalSettings）。
 *   set-state-in-effect  1 件 … BookingFlow の下書き復元。
 *
 * 🔴 【2026年8月18日 実測】react-hook-form を 7.82.0 → 7.85.0 へ上げても incompatible-library は
 * 3 件のまま消えなかった（上流未対応）。「次のリリースで消えるかもしれない」ではなく、
 * 実際に上げて数え直した結果である。React Compiler 自体はこのプロジェクトで未有効
 * （next.config.mjs に reactCompiler の指定なし・babel-plugin-react-compiler は依存にも
 * node_modules にも不在）なので、実行時への影響はゼロ。
 *
 * 🔴 【BookingFlow を直さない理由（代替案を全て検討した結論）】
 * sessionStorage の下書きを 1 回だけ読んで消し、10 個の編集可能な state へ流し込む処理。
 *   - useState の遅延初期化で読む → このコンポーネントは facility/[slug]/booking/page.tsx から
 *     SSR されるため、サーバ描画と初回クライアント描画が食い違い hydration mismatch になる。
 *   - useSyncExternalStore → 読み取り専用の導出値しか得られず、その後ユーザーが編集する
 *     10 個の state を seed できない。かつ getSnapshot は副作用禁止（removeItem を置けない）。
 *   - dynamic(ssr:false) → 予約ページのサーバ描画を捨てることになり、初回表示が退行する。
 *   - async IIFE で包む → 挙動を変えずに検出だけ消す症状ブロック。
 * 「外部システムとの同期」は React 公式が effect の正当な用途として挙げている形そのもので、
 * ここはルールの側が過剰に広い。据え置きが最善という結論。
 *
 * 🔴 【2026年8月18日 実測】このルールは局所関数越しの setState も追跡して検出する。
 * リポジトリ内に「effect 直下の AST の形しか見ない浅い構文検査」という記述があったが、
 * その点では不正確だった（async IIFE 越しは検出されないという既存の実測は再現した）。
 * そのため検査用の負の対照は配線で逃げず、eslint.config.mjs で当該 1 ファイルだけ off にしてある。
 *
 * 【BASELINE の変遷】
 *   6  … set-state-in-effect 等 4 ルールのみを数えていた時点（2026年8月16日）
 *   11 … 対象ルールへ incompatible-library（3件）と no-location-assign（2件）を追加。
 *        負債が増えたのではなく【監視対象を広げた】もの。
 *   10 … StationSearch を実機検証で根治して 1 件減。
 *   8  … 予約フローの空き状況と、予約日時変更の空き枠を実機検証で根治して 2 件減。
 *   6  … GBP 管理画面のタブ切替と口コミサマリーを根治して 2 件減（2026年8月18日）。
 *        実機ではなく jsdom で最初のコミットを捕まえる単体テスト（src/test-utils/first-frame.tsx）
 *        で検証した。旧コードで実際に落ちることを確認済み（gbp 5 件中 4 件・ReviewSummary 1 件）。
 */
export const BASELINE = 6;

/**
 * eslint の JSON 出力から、ラチェット対象ルールの指摘件数を数える。
 * 重大度は問わない（warn へ落としているため severity=1 で出るが、将来 error へ
 * 戻したときも同じ数え方で通るようにする）。
 *
 * @param {Array<{messages?: Array<{ruleId?: string|null}>}>} eslintResults `eslint -f json` の結果
 * @returns {number}
 */
export function countDebt(eslintResults) {
  if (!Array.isArray(eslintResults)) return 0;
  let count = 0;
  for (const file of eslintResults) {
    const messages = file && file.messages;
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (message && RATCHET_RULES.includes(message.ruleId)) count += 1;
    }
  }
  return count;
}

/**
 * 件数をベースラインと突き合わせ、CI を落とすべきかを返す。
 *
 * @param {number} count countDebt の結果
 * @param {number} [baseline] 既定は BASELINE
 * @returns {{ ok: boolean, message: string }}
 */
export function checkDebt(count, baseline = BASELINE) {
  if (count === baseline) {
    return { ok: true, message: `React Compiler 負債 ${count} 件（ベースラインどおり）` };
  }
  if (count > baseline) {
    return {
      ok: false,
      message:
        `React Compiler 負債が ${baseline} → ${count} 件へ増えた（+${count - baseline}）。\n` +
        `新しく追加したクライアントコンポーネントが、マウント時の fetch と setState を\n` +
        `useEffect の中で行っていないか確認すること。返済すべき負債を増やさないための検査。\n` +
        `対象ルール: ${RATCHET_RULES.join(', ')}`,
    };
  }
  return {
    ok: false,
    message:
      `React Compiler 負債が ${baseline} → ${count} 件へ減った（-${baseline - count}）。\n` +
      `返済ありがとうございます。src/lib/react-compiler-debt.mjs の BASELINE を ${count} に\n` +
      `更新してください（実態より大きいベースラインを残すと、その分だけ増加を見逃します）。`,
  };
}
