/**
 * メールアドレスを「同一人物判定（突合）用」に正規化する純粋関数。
 *
 * 背景（真の予防）: 圧倒的多数のユーザーが Gmail で、Gmail は
 *   - ローカル部のドットを無視（f.o.o@gmail.com = foo@gmail.com）
 *   - "+tag" 以降を無視（foo+abc@gmail.com = foo@gmail.com）
 *   - googlemail.com = gmail.com
 * として「すべて同一受信箱」に届ける。生 email を顧客識別キーにすると、同一人物が
 * 別エイリアスで「別顧客」に分裂し、new_customer 限定クーポンの複数回取得（金銭被害）・
 * repeat クーポンの誤拒否・RFM/customer_segments の分裂を招く。
 *
 * 方針:
 *   - 全ドメイン共通: trim + 小文字化
 *   - gmail.com / googlemail.com のみ: ローカル部のドット除去・"+"以降除去・ドメインを gmail.com に統一
 *   - 非 Gmail: ドット/"+" の扱いはプロバイダ依存のため変更しない（別人を誤って併合しないための保守的判断）
 *
 * 用途: 保存・送信は原文（小文字化）を、突合（履歴照合・集計キー）は本関数の結果を使う。
 * 入力は zod の .email() 検証後を想定（@ を含む妥当なアドレス）。@ を持たない値は小文字化のみ返す。
 */
export function canonicalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0) return lower; // ローカル部が空 or @ 無しは正規化対象外（防御）
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
    if (local === '') return lower; // "+x@gmail.com" 等の不正入力は元の小文字を返す
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
