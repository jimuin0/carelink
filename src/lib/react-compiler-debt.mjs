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

/** ラチェットの対象ルール。eslint.config.mjs で warn に落としているものと一致させる。 */
export const RATCHET_RULES = [
  'react-hooks/set-state-in-effect',
  'react-hooks/purity',
  'react-hooks/immutability',
  'react-hooks/refs',
];

/**
 * 現在の負債件数。2026年8月16日 に eslint-config-next 16.3.0 / React 19 で実測した値。
 * 内訳: set-state-in-effect 64 / purity 3 / immutability 3 / refs 2。
 * 返済したらこの数を下げること（下げ忘れは checkDebt が検知する）。
 */
export const BASELINE = 72;

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
