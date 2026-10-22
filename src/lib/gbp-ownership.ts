/**
 * Google の店舗（Place ID）が、CareLink に登録された施設のものと言えるかの判定（2026年10月23日 新設）。
 *
 * 🔴 【なぜ要るか】店舗オーナーが GBP 設定に【他店の Place ID】を保存すると、Google の評価・件数が
 * 自店の掲載（検索結果・ランキング・店舗ページ）に Google ロゴ付きで表示され、「地図を見る」も
 * 他店を指していた。保存時に見ていたのは ID の形式だけで、その店舗が誰のものかは一度も確かめていなかった。
 *
 * 【判定】次のどちらかが成り立てば「この施設の店舗」とみなす（誤って弾いた場合は運営が個別に対応する）。
 *   1. 電話番号が一致する（ハイフン・全角・+81 の表記ゆれをそろえて比べる）
 *   2. 店舗名が一致し（片方がもう片方を含めばよい。「〇〇 渋谷店」等の支店名の有無を許す）、かつ住所が一致する
 *      （市区町村＋番地の先頭 2 つまでが Google の住所に含まれる、または郵便番号と市区町村が一致する）
 *
 * 同じ判定を【評価を書き込む全経路】（保存・管理画面の診断・週次 cron）で使う。保存時だけ見ると、
 * 一時的に電話番号を他店に合わせて保存し、すぐ戻すだけで素通りできるため。
 */
import type { PlaceDetails } from './gbp';

/** 判定に使う施設の登録内容（facility_profiles の列名そのまま）。 */
export interface FacilityIdentity {
  name?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
}

/** 判定に使う facility_profiles の列（select にそのまま渡す）。 */
export const FACILITY_IDENTITY_COLUMNS = 'name, phone, postal_code, prefecture, city, address';

/** 保存時に Google から店舗情報を取れなかったとき（ID の誤り・Google 側の障害）。 */
export const GBP_PLACE_LOOKUP_FAILED_MESSAGE =
  'Google の店舗情報を確認できませんでした。Place ID が正しいかご確認ください。解決しない場合は CareLink までお問い合わせください。';

/** 保存時に Google の店舗情報が施設の登録内容と合わないとき。 */
export const GBP_PLACE_MISMATCH_MESSAGE =
  'この Place ID の Google 店舗情報が、登録されている店舗情報（電話番号、または店舗名と住所）と一致しないため保存できません。ご自身の店舗で間違いない場合は CareLink までお問い合わせください。';

/** 同じ Place ID が別の施設に登録済みのとき。 */
export const GBP_PLACE_TAKEN_MESSAGE =
  'この Place ID は別の店舗に登録されています。ご自身の店舗で間違いない場合は CareLink までお問い合わせください。';

/** 保存済みの Place ID が施設の登録内容と合わず、評価を表示していないとき（診断・クチコミ画面）。 */
export const GBP_PLACE_MISMATCH_NOTICE =
  '登録中の Place ID の Google 店舗情報が、この店舗の登録内容（電話番号、または店舗名と住所）と一致しないため、Google の評価・クチコミを表示していません。Place ID と店舗情報をご確認のうえ、解決しない場合は CareLink までお問い合わせください。';

/** 日本の電話番号を、数字だけの国内表記（0 始まり・10〜11 桁）にそろえる。それ以外は null。 */
export function normalizeJapanesePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.normalize('NFKC').replace(/\D/g, '');
  // 国内の番号は 0 から始まるので、81 から始まるのは国番号付き（+81 3-…・+81 (0)3-…）。
  if (digits.startsWith('81')) {
    const rest = digits.slice(2);
    digits = rest.startsWith('0') ? rest : `0${rest}`;
  }
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

/** 店舗名の比較用: 全角半角・大文字小文字・空白・記号の差を消す。 */
function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 店舗名が一致する（片方がもう片方を含む）。2 文字未満は一致とみなさない。 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * 住所の比較用: 全角半角・空白・国名・郵便番号を除き、「1丁目2番3号」「1−2−3」を「1-2-3」へそろえる。
 */
export function normalizeAddress(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/^日本[、,]?/, '')
    .replace(/〒\d{3}-?\d{4}/g, '')
    .replace(/[‐‑‒–—―−﹣]/g, '-')
    .replace(/(\d)ー(?=\d)/g, '$1-')
    .replace(/(\d)(丁目|番地|番|号)/g, '$1-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

/** 郵便番号（7 桁の数字）。無ければ null。 */
function postalDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').normalize('NFKC').replace(/\D/g, '');
  return digits.length === 7 ? digits : null;
}

/**
 * 施設の住所から「市区町村＋番地の先頭 2 つまで」を作る（建物名・部屋番号の書き方の差を見ない）。
 * 例: 市区町村「渋谷区」・住所「渋谷1丁目2番3号 ○○ビル5F」→「渋谷区渋谷1-2」
 */
function facilityStreetKey(facility: FacilityIdentity): string | null {
  const city = normalizeAddress(facility.city);
  if (!city) return null;
  const prefecture = normalizeAddress(facility.prefecture);
  let street = normalizeAddress(facility.address);
  if (prefecture && street.startsWith(prefecture)) street = street.slice(prefecture.length);
  if (street.startsWith(city)) street = street.slice(city.length);
  const head = street.match(/^\D*\d+(?:-\d+)?/);
  const core = head ? head[0] : street;
  return core ? city + core : null;
}

/** Google の住所が施設の住所と一致する。 */
export function addressesMatch(googleAddress: string | null | undefined, facility: FacilityIdentity): boolean {
  const raw = (googleAddress ?? '').normalize('NFKC');
  const google = normalizeAddress(raw);
  if (!google) return false;
  const key = facilityStreetKey(facility);
  if (key && google.includes(key)) return true;
  const city = normalizeAddress(facility.city);
  const googlePostal = raw.match(/〒\s*(\d{3})-?(\d{4})/);
  const facilityPostal = postalDigits(facility.postal_code);
  return Boolean(city && googlePostal && facilityPostal === googlePostal[1] + googlePostal[2] && google.includes(city));
}

/** Google の店舗が、この施設のものと言えるか（上の判定 1 または 2）。 */
export function placeMatchesFacility(place: PlaceDetails, facility: FacilityIdentity): boolean {
  const phone = normalizeJapanesePhone(facility.phone);
  if (phone && normalizeJapanesePhone(place.formatted_phone_number) === phone) return true;
  return namesMatch(place.name, facility.name) && addressesMatch(place.formatted_address, facility);
}
