/** Fixed public messages: never echo submitted values or raw provider errors. */
export const SALON_FIELD_MESSAGES = {
  facility_name: '施設名を1〜200文字で入力してください',
  business_type: '一覧から業種を選択してください',
  representative_name: '代表者名を1〜100文字で入力してください',
  contact_name: '担当者名を1〜100文字で入力してください',
  email: 'メールアドレスを確認してください（254文字以内）',
  phone: '電話番号を確認してください',
  contact_phone: '担当者直通電話を確認してください',
  website: 'WebサイトURLを確認してください（2000文字以内）',
  postal_code: '郵便番号は7桁で入力してください（ハイフン可）',
  address: '住所を500文字以内で入力してください',
  prefecture: '住所の都道府県を確認してください',
  city: '住所の市区町村を確認してください',
  building_name: '建物名・部屋番号を200文字以内で入力してください',
  nearest_station: '最寄り駅を200文字以内で入力してください',
  business_hours: '営業時間を200文字以内で入力してください',
  regular_holiday: '定休日を200文字以内で入力してください',
  seat_count: '席数・ベッド数は0〜9999の整数で入力してください',
  staff_count: 'スタッフ数は0〜9999の整数で入力してください',
  has_parking: '駐車場の選択を確認してください',
  features: 'こだわり・特徴の選択を確認してください',
  pr_text: 'PR文を1000文字以内で入力してください',
  desired_start_date: '一覧から掲載希望時期を選択してください',
  photo_url: '施設写真を確認してください',
  photo_urls: '施設写真を確認してください（最大7枚）',
} as const;

export type SalonField = keyof typeof SALON_FIELD_MESSAGES;
export type SalonFieldErrors = Partial<Record<SalonField, string>>;

export function isSalonField(value: unknown): value is SalonField {
  return typeof value === 'string' && Object.hasOwn(SALON_FIELD_MESSAGES, value);
}

export function salonFieldErrors(issues: readonly { path: readonly PropertyKey[] }[]): SalonFieldErrors {
  const errors: SalonFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (isSalonField(field)) errors[field] = SALON_FIELD_MESSAGES[field];
  }
  return errors;
}
