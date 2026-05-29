/* Stryker disable StringLiteral, ArrayDeclaration */
export const prefectures = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export const businessTypes = [
  'ヘアサロン',
  'ネイル・まつげサロン',
  'リラクサロン',
  'エステサロン',
  '美容クリニック',
  '鍼灸院・整骨院',
  'ピラティス',
  'その他',
];

export const facilityFeatures = [
  '駐車場あり', '個室あり', 'キッズスペース', 'バリアフリー',
  'WiFi完備', 'クレジットカード可', '当日予約OK', '女性専用',
  '男性歓迎', '深夜営業', '早朝営業', '年中無休',
  '送迎あり', '訪問対応可', '保険適用', '初回カウンセリング無料',
];

export const regionGroups = [
  { name: '北海道・東北', prefectures: ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefectures: ['東京都', '神奈川県', '埼玉県', '千葉県', '茨城県', '栃木県', '群馬県'] },
  { name: '中部', prefectures: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'] },
  { name: '近畿', prefectures: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { name: '中国・四国', prefectures: ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州・沖縄', prefectures: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
];

export const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const dayLabels: Record<string, string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日',
};
/* Stryker restore StringLiteral, ArrayDeclaration */

/** UUID v4 validation pattern */
/* Stryker disable Regex -- module-level const evaluated at init; perTest coverage can't attribute to specific tests; logic verified by UUID_REGEX.test() tests */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Stryker restore Regex */

/** サイトURL（環境変数 or デフォルト）
 * 防御層: 末尾空白/改行除去 + www→apex強制 + 末尾スラ除去
 * （Vercel環境変数に末尾改行が混入してsitemapが壊れた事案への恒久対策）
 */
export function normalizeSiteUrl(raw: string | undefined): string {
  const trimmed = (raw || 'https://carelink-jp.com').trim().replace(/\/+$/, '');
  return trimmed.replace(/^https?:\/\/www\.carelink-jp\.com/i, 'https://carelink-jp.com');
}
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_BASE_URL);
