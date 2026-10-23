/**
 * 業種の【表示名】。保存値（facility_profiles.business_type・salons.business_type・
 * URL の ?type=・/type/<slug> の対応表）は変えずに、画面に出す名前だけを差し替える。
 *
 * 【2026年10月23日 神原さん決定】業種「鍼灸院・整骨院」に整体を含める。表示名は「鍼灸院・整骨院・整体」。
 *
 * 🔴 保存値そのものを変えないこと。
 *   - business_type は検索・カテゴリ導線・/type/* ・都道府県×業種ページの結合キーで、
 *     既存の施設・受付の行と、外部に出回っている /search?type=鍼灸院・整骨院 の URL がこの値を持つ。
 *   - DB 側の受付・施設作成の関数（migration 20260930075358 ほか）が許可する業種を
 *     この文字列で列挙している。値を変えると登録そのものが拒否される。
 * よって画面に出すところだけを、この関数を通して表示名にする。フォームの <option> は
 * value に保存値、表示に表示名を使う（送信される値は従来と同じ）。
 *
 * src/__tests__/business-type-label.test.ts が、業種を表示している画面がこの関数を通していることを固定する。
 */
export const BUSINESS_TYPE_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  '鍼灸院・整骨院': '鍼灸院・整骨院・整体',
};

/** 保存値 → 表示名。対応表に無い値・空はそのまま返す（未知の値を隠さない）。 */
export function businessTypeLabel(value: string): string;
export function businessTypeLabel(value: string | null | undefined): string | null | undefined;
export function businessTypeLabel(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return Object.hasOwn(BUSINESS_TYPE_DISPLAY_LABELS, value) ? BUSINESS_TYPE_DISPLAY_LABELS[value] : value;
}
