/**
 * スタッフの得意分野（staff_profiles.specialties: text[]）の入力欄 ⇄ 配列。
 *
 * 以前は半角カンマでしか区切っておらず、日本語で自然に打つ「カット、カラー」や全角の「，」、
 * 改行で並べた入力が 1 つの得意分野として保存されていた（一覧には先頭 3 件しか出ないので、
 * 長い 1 件が丸ごと出るか、区切ったつもりの項目が消えて見える）。
 * 区切り＝半角カンマ・全角カンマ・読点・改行。空の項目と同じ項目の重複は落とす。
 */
const SEPARATORS = /[,，、\r\n]+/;

export function parseSpecialties(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(SEPARATORS)) {
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** 保存済みの配列を入力欄に戻す（読点区切り）。 */
export function formatSpecialties(values: readonly string[] | null | undefined): string {
  return (values ?? []).join('、');
}
