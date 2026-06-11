/* Stryker disable StringLiteral, ArrayDeclaration, ObjectLiteral -- これらは全てモジュール読込時に1度だけ評価される静的データ定数。coverageAnalysis:'perTest' は変異をテスト実行時に有効化するが、定数は既に確定済みのため構造的に kill 不能（等価/静的変異）。例: dayLabels→{} 変異は既存テスト（dayLabels.mon==='月' 等）で実害は発症前に捕捉済みだが Stryker は static 注入できず survived 表示になる。神原さん承認済み(2026-06-10)。ObjectLiteral の実 kill は 0 件＝disable で失う検証なし。 */
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
/* Stryker restore StringLiteral, ArrayDeclaration, ObjectLiteral */

/** UUID v4 validation pattern */
/* Stryker disable Regex -- module-level const evaluated at init; perTest coverage can't attribute to specific tests; logic verified by UUID_REGEX.test() tests */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Stryker restore Regex */

/** サイトURL（環境変数 or デフォルト）
 * 防御層: 末尾空白/改行除去 + www→apex強制 + 末尾スラ除去
 * （Vercel環境変数に末尾改行が混入してsitemapが壊れた事案への恒久対策）
 */
export function normalizeSiteUrl(raw: string | undefined): string {
  // 1. 未設定/null は '' に（?? は null/undefined のみ）→ trim で前後空白除去
  // 2. 末尾の「空白・スラッシュの連続」を /[\s/]+$/ で一括除去（順序非依存・冪等）。
  //    旧実装は .replace(/\/+$/,'').trim() の順で、"a/ "（スラッシュの後ろに空白）や
  //    "https://carelink-jp.com/ " のように末尾スラッシュの後に空白がある入力を取りこぼし、
  //    末尾 "/" 追加で結果が変わる不変条件違反があった（fast-check が検出）。空白とスラッシュを
  //    まとめて落とすことで「末尾 / 追加は結果に影響しない」を全入力で保証する。
  // 3. 空文字（未設定/空白のみ/"/"のみ 等）はここで一括してデフォルトにフォールバック（default は1箇所）
  const stripped = (raw ?? '').trim().replace(/[\s/]+$/, '');
  const base = stripped || 'https://carelink-jp.com';
  return base.replace(/^https?:\/\/www\.carelink-jp\.com/i, 'https://carelink-jp.com');
}
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_BASE_URL);
