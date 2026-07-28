/**
 * 医療広告ガイドライン・あはき法の禁止表現ガード
 *
 * 【2026年7月28日 新設・構造的リスクの根治】
 * CareLink は医療・福祉・美容を横断するプラットフォームで、施設オーナーが自由入力する
 * PR 文言（catch_copy / description）と来院者が投稿するレビュー本文を、法令適合性の
 * チェックなしにそのまま公開していた。
 *
 * 医療機関には医療法6条の5・医療広告ガイドラインにより、体験談の掲載や
 * 「絶対安全」「必ず治る」等の誇大表現・比較優良広告が原則禁止されている。
 * あん摩マッサージ指圧師・はり師・きゅう師にも あはき法7条 の広告制限がある。
 * 場の提供者にとどまらず「広告を行った者」として連帯責任を問われうるため、
 * 公開前に検知する仕組みを設ける（事後モデレーションだけでは公開されてしまう）。
 *
 * 【設計方針】
 * - 施設オーナーの PR 文言は「入口で拒否」する。書き直しを促せるうえ、
 *   一度公開してから消すより確実（発症前予防）。
 * - 来院者のレビューは拒否せず「審査キューに載せる」。投稿体験を壊さずに
 *   運営が確認できる状態にする（誤検知で善意の投稿を弾かないため）。
 * - 正規表現ではなく単純な部分一致にする。可読性が高く、運用で語を足しやすい。
 */

/** 検知した禁止表現の分類。運営が是正内容を判断できるよう理由を添える。 */
export interface MedicalAdViolation {
  /** 実際に含まれていた語 */
  term: string;
  /** なぜ問題か（利用者に提示する文言） */
  reason: string;
}

/**
 * 医療広告ガイドラインで禁止される表現。
 * 【重要】語を足すときは必ず「その語単体で問題になるか」を確認すること。
 * 一般的な語（例：「安心」「丁寧」）を入れると善意の文章まで弾いてしまう。
 */
const BANNED_TERMS: { terms: string[]; reason: string }[] = [
  {
    terms: ['必ず治る', '必ず治り', '絶対治る', '100%治る', '完治します', '確実に治る'],
    reason: '治療効果を保証する表現は医療広告ガイドラインで禁止されています',
  },
  {
    terms: ['絶対安全', '絶対に安全', '副作用は一切', '副作用なし', 'リスクはありません'],
    reason: '安全性を断定する表現は医療広告ガイドラインで禁止されています',
  },
  {
    terms: ['日本一', '日本初', '世界一', 'No.1', 'ナンバーワン', '最高の技術', '最先端の治療'],
    reason: '他との比較優良を示す表現は医療広告ガイドラインで禁止されています（客観的根拠があっても広告では使えません）',
  },
  {
    terms: ['特効薬', '万能', '奇跡の', '魔法のような'],
    reason: '誇大な効果を示す表現は医療広告ガイドラインで禁止されています',
  },
  {
    terms: ['がんが消える', 'ガンが消える', '癌が治る', 'がんが治る'],
    reason: '重篤な疾患への治療効果をうたう表現は認められていません',
  },
  {
    terms: ['今だけ', '期間限定で無料', '先着', 'キャンペーン価格'],
    reason: '医療機関では費用の過度な強調・誘引が制限されています（自由診療の価格表示は正確に記載してください）',
  },
];

/**
 * 文字列に医療広告ガイドライン上の禁止表現が含まれるか検査する。
 * 空文字・null・undefined は検査対象なし（違反0件）として扱う。
 */
export function findMedicalAdViolations(text: string | null | undefined): MedicalAdViolation[] {
  if (!text) return [];

  const violations: MedicalAdViolation[] = [];
  for (const group of BANNED_TERMS) {
    for (const term of group.terms) {
      if (text.includes(term)) {
        violations.push({ term, reason: group.reason });
      }
    }
  }
  return violations;
}

/**
 * 施設の PR 文言として公開してよいかを判定する。
 * 違反があれば、そのまま利用者に見せられるメッセージを返す。
 */
export function validateFacilityPrText(text: string | null | undefined): { ok: true } | { ok: false; message: string } {
  const violations = findMedicalAdViolations(text);
  if (violations.length === 0) return { ok: true };

  // 同じ理由で複数語が当たった場合に同一文を繰り返さない。
  const reasons = [...new Set(violations.map((v) => v.reason))];
  const terms = violations.map((v) => `「${v.term}」`).join('、');
  return {
    ok: false,
    message: `${terms} は使用できません。${reasons.join(' / ')}`,
  };
}
