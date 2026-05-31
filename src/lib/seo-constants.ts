// 都道府県スラッグマッピング
/* Stryker disable StringLiteral */
export const prefectureSlugs: Record<string, string> = {
  hokkaido: '北海道',
  aomori: '青森県',
  iwate: '岩手県',
  miyagi: '宮城県',
  akita: '秋田県',
  yamagata: '山形県',
  fukushima: '福島県',
  ibaraki: '茨城県',
  tochigi: '栃木県',
  gunma: '群馬県',
  saitama: '埼玉県',
  chiba: '千葉県',
  tokyo: '東京都',
  kanagawa: '神奈川県',
  niigata: '新潟県',
  toyama: '富山県',
  ishikawa: '石川県',
  fukui: '福井県',
  yamanashi: '山梨県',
  nagano: '長野県',
  gifu: '岐阜県',
  shizuoka: '静岡県',
  aichi: '愛知県',
  mie: '三重県',
  shiga: '滋賀県',
  kyoto: '京都府',
  osaka: '大阪府',
  hyogo: '兵庫県',
  nara: '奈良県',
  wakayama: '和歌山県',
  tottori: '鳥取県',
  shimane: '島根県',
  okayama: '岡山県',
  hiroshima: '広島県',
  yamaguchi: '山口県',
  tokushima: '徳島県',
  kagawa: '香川県',
  ehime: '愛媛県',
  kochi: '高知県',
  fukuoka: '福岡県',
  saga: '佐賀県',
  nagasaki: '長崎県',
  kumamoto: '熊本県',
  oita: '大分県',
  miyazaki: '宮崎県',
  kagoshima: '鹿児島県',
  okinawa: '沖縄県',
};
/* Stryker restore StringLiteral */

// 業種スラッグマッピング
/* Stryker disable StringLiteral */
export const businessTypeSlugs: Record<string, string> = {
  'hair-salon': 'ヘアサロン',
  'nail-eyelash': 'ネイル・まつげサロン',
  relaxation: 'リラクサロン',
  esthetic: 'エステサロン',
  'beauty-clinic': '美容クリニック',
  acupuncture: '鍼灸院・整骨院',
  'care-service': '介護・デイサービス',
  other: 'その他',
};
/* Stryker restore StringLiteral */

// 逆引き: 日本語名 → スラッグ
/* Stryker disable ArrayDeclaration */
const prefectureNameToSlug = Object.fromEntries(
  Object.entries(prefectureSlugs).map(([slug, name]) => [name, slug])
);
const businessTypeNameToSlug = Object.fromEntries(
  Object.entries(businessTypeSlugs).map(([slug, name]) => [name, slug])
);
/* Stryker restore ArrayDeclaration */

export function getPrefectureSlug(name: string): string | undefined {
  return Object.hasOwn(prefectureNameToSlug, name) ? prefectureNameToSlug[name] : undefined;
}

export function getBusinessTypeSlug(name: string): string | undefined {
  return Object.hasOwn(businessTypeNameToSlug, name) ? businessTypeNameToSlug[name] : undefined;
}

export function getPrefectureName(slug: string): string | undefined {
  return Object.hasOwn(prefectureSlugs, slug) ? prefectureSlugs[slug] : undefined;
}

export function getBusinessTypeName(slug: string): string | undefined {
  return Object.hasOwn(businessTypeSlugs, slug) ? businessTypeSlugs[slug] : undefined;
}

// 全スラッグ配列（generateStaticParams用）
export const allPrefectureSlugs = Object.keys(prefectureSlugs);
export const allBusinessTypeSlugs = Object.keys(businessTypeSlugs);

// スラッグ存在チェック（衝突防止用）
export function isValidPrefectureSlug(slug: string): boolean {
  return Object.hasOwn(prefectureSlugs, slug);
}

export function isValidBusinessTypeSlug(slug: string): boolean {
  return Object.hasOwn(businessTypeSlugs, slug);
}
