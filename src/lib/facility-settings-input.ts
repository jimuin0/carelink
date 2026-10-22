/**
 * 施設設定（/admin/settings ↔ PATCH /api/admin/settings）の入力の整え方と、欄ごとのエラー文言の単一ソース。
 *
 * 以前は Web サイト欄に `www.example.com` と書くだけで URL 検査に落ち、住所・営業時間を含む
 * 保存全体が「リクエストが不正です」で失敗していた（どの欄が悪いのかも分からなかった）。
 */

/** スキームの無い Web サイトは https:// を補う。空文字は「URL を外す」なのでそのまま返す。 */
export function normalizeWebsiteUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** 掲載ページにリンクとして出すので http(s) だけを受け付ける（javascript: 等を載せない）。 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** オーナーに見せる欄名。API のキー → 画面のラベル。 */
export const SETTINGS_FIELD_LABELS: Record<string, string> = {
  name: '施設名',
  business_type: '業種',
  catch_copy: 'キャッチコピー',
  description: '施設紹介',
  postal_code: '郵便番号',
  prefecture: '都道府県',
  city: '市区町村',
  address: '町名・番地',
  building: '建物名・階',
  access_info: 'アクセス情報',
  nearest_station: '最寄り駅',
  phone: '電話番号',
  website_url: 'Webサイト',
  seat_count: '席数',
  staff_count: 'スタッフ数',
  features: 'その他の特徴',
  regular_holiday: '定休日（補足）',
  business_hours: '営業時間',
  booking_buffer_minutes: '施術後バッファタイム',
  board_slot_minutes: 'サロンボードの時間刻み',
};

const FIELD_HINTS: Record<string, string> = {
  website_url: 'WebサイトのURLを確認してください（例: https://example.com）',
};

/**
 * 検査で落ちた欄ごとの文言。キーは API のフィールド名（画面はこれを欄の下に出す）。
 * 欄名の分からない問題は `_` にまとめる。
 */
export function settingsFieldErrors(issues: readonly { path: readonly PropertyKey[] }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '_');
    if (errors[key]) continue;
    const label = SETTINGS_FIELD_LABELS[key];
    errors[key] = FIELD_HINTS[key] ?? (label ? `${label}の入力内容を確認してください` : '入力内容を確認してください');
  }
  return errors;
}

/** トーストに出す1行。どの欄を直せばよいかを名前で示す。 */
export function settingsErrorSummary(fields: Record<string, string>): string {
  const labels = Object.keys(fields).map(key => SETTINGS_FIELD_LABELS[key]).filter((label): label is string => Boolean(label));
  return labels.length > 0 ? `入力内容を確認してください：${labels.join('、')}` : '入力内容を確認してください';
}
