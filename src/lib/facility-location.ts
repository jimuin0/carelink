/**
 * 施設の所在地（facility_profiles の city / address）を、公開ページとエリアページが前提とする形へ揃える。
 *
 * 🔴 なぜ必要か（2026年10月22日）
 * 1. /register の申込は住所を「都道府県＋市区町村＋番地」の 1 本の文字列で持つ。取り込み時に
 *    それを address へそのまま写していたため、公開ページの所在地（prefecture + city + address）で
 *    「大阪府大阪市北区大阪府大阪市北区梅田1-1」のように都道府県と市区町村が 2 回出ていた。
 * 2. エリアページ（/[都道府県]/[市区町村]）は city の完全一致で施設を探す（facilities.ts の .eq('city')）。
 *    マスタ（src/data/city-slugs.ts）は政令指定都市を「横浜市」のように市で持ち、大阪市だけは
 *    「北区」のように区で持つ。ところが郵便番号検索の値は「横浜市中区」「大阪市北区」、
 *    住所からの復元は「大阪市」になるため、政令指定都市の店舗はどのエリアページにも出なかった。
 *
 * 書き込み口は 2 つあり、同じ規則を通す：
 *   - /api/admin/settings（このモジュール）
 *   - 申込からの施設作成 setup_facility_from_registration（SQL 版 public.normalize_facility_location。
 *     申込の値は DB 内で確定するため SQL で持つ。両者の表と結果の一致は
 *     src/lib/__tests__/facility-location.test.ts と supabase/shadow/facility-setup-fixtures.sql が固定する）
 *
 * 受付の正規化（canonicalSalonSubmission・HMAC）は変えない。申込の記録はそのまま残し、
 * 施設として書き込む時点で揃える。
 */
import { citySlugs } from '@/data/city-slugs';

/** 政令指定都市（20 市）。大阪市以外はマスタが市の単位で持つ。 */
export const DESIGNATED_CITIES = [
  '札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '川崎市', '相模原市', '新潟市', '静岡市', '浜松市',
  '名古屋市', '京都市', '大阪市', '堺市', '神戸市', '岡山市', '広島市', '北九州市', '福岡市', '熊本市',
] as const;

/** マスタが区の単位で持つ唯一の政令指定都市。 */
export const OSAKA_CITY = '大阪市';

/** 大阪市の区。マスタ（大阪府の「〜区」）から導出し、手で二重に持たない。 */
export const OSAKA_CITY_WARDS: readonly string[] = Object.values(citySlugs.osaka).filter((name) => name.endsWith('区'));

export interface FacilityLocationInput {
  prefecture?: string | null;
  city: string | null | undefined;
  address: string | null | undefined;
}

/** 長いものから照合する（ある名前が別の名前の接頭辞になっても取り違えないため）。 */
function longestPrefix(value: string, candidates: readonly string[]): string | undefined {
  return [...candidates].sort((a, b) => b.length - a.length).find((candidate) => value.startsWith(candidate));
}

/** 先頭が prefix なら取り除いて前の空白を詰める。一致しなければ何もしない。 */
function stripLeading(value: string, prefix: string): string {
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length).trimStart() : value;
}

/**
 * 1. address の先頭から都道府県を、続けて市区町村（入力された city）を取り除く。一致しなければ触らない。
 * 2. city をマスタの単位へ揃える：
 *    - 大阪市：区を残す（大阪市北区 → 北区）。「大阪市」だけなら番地の先頭の区を city へ移す。
 *    - 他の政令指定都市：最初の「市」まで（横浜市中区 → 横浜市）。区は番地の先頭へ移し、所在地を欠かさない。
 *    - 区の形でない値（例: 大阪市の存在しない区）は推測せず、そのまま残す。
 */
export function normalizeFacilityLocation(input: FacilityLocationInput): { city: string; address: string } {
  const prefecture = (input.prefecture ?? '').trim();
  const rawCity = (input.city ?? '').trim();
  let city = rawCity;
  let address = stripLeading(stripLeading((input.address ?? '').trim(), prefecture), rawCity);

  const designated = longestPrefix(rawCity, DESIGNATED_CITIES);
  if (designated) {
    const ward = rawCity.slice(designated.length).trim();
    if (designated === OSAKA_CITY) {
      const osakaWard = ward === '' ? longestPrefix(address, OSAKA_CITY_WARDS) : OSAKA_CITY_WARDS.find((name) => name === ward);
      if (osakaWard) {
        city = osakaWard;
        address = stripLeading(address, osakaWard);
      }
    } else if (ward.length > 1 && ward.endsWith('区') && !/\s/.test(ward)) {
      city = designated;
      address = stripLeading(address, designated);
      if (!address.startsWith(ward)) address = ward + address;
    }
  }
  return { city, address };
}
