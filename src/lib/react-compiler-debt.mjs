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
 * 現在の負債件数。2026年8月16日 に eslint-config-next 16.3.0 / React 19 で実測した値。
 * 返済したらこの数を下げること（下げ忘れは checkDebt が検知する）。
 *
 * 72 件から 5 件まで返済済み（この 5 件に下記 incompatible-library 3 件と
 * no-location-assign 2 件を足した 10 件が BASELINE）。残る set-state-in-effect 5 件：
 *
 *   gbp/page.tsx                        タブ切替時のローディング表示
 *   mypage/bookings/[id]/change/page.tsx 日付変更時に前日の枠と選択をクリア
 *   BookingFlow.tsx x2                   sessionStorage からの下書き復元／空き状況のローディング
 *   ReviewSummary.tsx                    二重取得ガードと生成中表示
 *
 * 🔴 【2026年8月16日 実機検証で前提が覆った】
 * それまで「effect のトップレベルに置けばその瞬間に表示が切り替わる」と書いていたが、これは誤り。
 * useEffect はブラウザのペイント後に走るため【最初のフレームには間に合わない】。
 * StationSearch で実測したところ、初回オープンの最初の描画（クリックから 39ms）が
 * 「該当する駅がありません」で、その次のコミットで「読み込み中...」に変わっていた。
 * つまり読み込みを試す前に「駅が無い」と誤って告げていた。
 *
 * 正しい直し方は【イベントハンドラ側で setState する】こと。setOpen(true) と同じ更新に
 * まとまるので最初のフレームから反映され、ルールの指摘も原因ごと消える（症状ブロックではない）。
 * StationSearch はこの形へ直し、修正後の最初の描画が「読み込み中...」になることを実測で確認した。
 *
 * 残る 5 件を同じ形へ直していないのは、いずれも【この環境で実機確認できない】ため：
 * gbp と change は認証必須、BookingFlow と ReviewSummary は施設データが無く到達できない。
 * 未確認のまま描画を変えるより、実測できる状態で直す方を選んだ。
 * なお async IIFE の中へ移すのは、挙動を変えずに検出だけ消す症状ブロックなので依然として不可
 * （このルールは effect 本体の直下という AST の形しか見ない浅い構文検査である）。
 *
 * 【BASELINE の変遷（2026年8月16日）】
 *   6  … set-state-in-effect 等 4 ルールのみを数えていた時点
 *   11 … 対象ルールへ incompatible-library（3件）と
 *        no-location-assign-relative-destination（2件）を追加。負債が増えたのではなく
 *        【監視対象を広げた】もの。同日 no-unused-vars 62 件等はすべて解消済みで、
 *        lint の警告はこの 11 件だけになっていた（実測: 86 → 11）。
 *   10 … StationSearch を実機検証で根治して 1 件減（実測: 11 → 10）。
 */
export const BASELINE = 10;

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
