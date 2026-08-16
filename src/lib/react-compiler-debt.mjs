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
 * 72 件から 6 件まで返済済み。残る 6 件は【意図的に残してある】：
 *
 *   gbp/page.tsx                        タブ切替時に即ローディング表示へ（空表示の誤解を防ぐ）
 *   mypage/bookings/[id]/change/page.tsx 日付変更時に前日の枠と選択を即クリア（日時取り違え防止）
 *   BookingFlow.tsx x2                   sessionStorage からの下書き復元／空き状況の即ローディング表示
 *   ReviewSummary.tsx                    二重取得ガードと生成中表示
 *   StationSearch.tsx                    パネルを開いた瞬間のスピナー表示
 *
 * 🔴 これらを「直す」ことは技術的には簡単だが、やってはいけない。
 * 実測（2026年8月16日）: このルールは effect 本体の直下という AST の形しか見ない浅い構文検査で、
 * async IIFE の中へ同期 setState を移すと【挙動を1ミリも変えずに検出だけが消える】。
 * 上記6件はいずれも「その瞬間に表示を切り替える」ことが要件なので、遅延させる修正は挙動退行、
 * IIFE へ隠す修正は症状ブロックにしかならない。よって検出を残したまま件数として計上する。
 * 各箇所のコード上のコメントに、なぜ意図的かを個別に書いてある。
 *
 * 2026年8月16日 追記: 対象ルールへ incompatible-library（3件）と
 * no-location-assign-relative-destination（2件）を追加したため 6 → 11 になった。
 * これは負債が増えたのではなく【監視対象を広げた】もの。それ以外の警告（no-unused-vars 62件等）は
 * 同日すべて解消済みで、lint の警告はこの 11 件だけである（実測: 86 → 11）。
 */
export const BASELINE = 11;

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
