import { businessWindows, type MinuteWindow } from './business-hours';
import { cache } from 'react';
import { createServerSupabaseClient, createServiceRoleClient } from './supabase-server';
import type { Facility, FacilityCardData, FacilityMenu, FacilityPhoto, FacilityReview, SearchParams, ScheduleOverride } from '@/types';
import { cachedFetch } from './redis';
import { jstMonthInfo, dayOfWeekUtc, addDays } from './admin-date';
import { SLOT_OCCUPYING_STATUSES } from './booking-status';
import type { CancelPolicy } from './cancel-fee';
import { isCardBookingReady } from './facility-publish-gate';
import { OSAKA_CITY, OSAKA_CITY_WARDS } from './facility-location';
import { readPageResult } from './page-read-verification';
import { bookingDurationForMenus, MENU_DURATION_FALLBACK_MINUTES } from './booking-slot-rules';
import { isPublicReadOnlyPreview } from './preview-capabilities';

const PER_PAGE = 20;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Card list queries use facility_card_view (has computed min_price, max_price, menu_count, coupon_count, photo_count)
// Note: Supabase view queries return generic types, so `as unknown as FacilityCardData[]` casts are intentional.
const CARD_VIEW = 'facility_card_view';
export const CARD_COLS = 'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, google_rating, google_review_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, special_hours, seat_count, booking_menu_count, active_staff_count, has_address';

/** キーワード検索で一度に扱う語数の上限（1語ごとに ILIKE が 6 本増えるため青天井にしない）。 */
export const KEYWORD_MAX_TERMS = 5;

/**
 * 検索キーワードを空白区切りの語に分解する（2026年8月11日 新設）。
 *
 * 【なぜ必要か＝実際に起きていた欠陥】従来は入力全体を1つの ILIKE パターン
 * `%豊中 まつげ%` にしていたため、その並びを literal に含む施設しか当たらず、
 * 【複数語で検索すると常に 0 件】だった。検索は主要導線なので影響が大きい。
 * 本番の実データでも、特集 `eyelash-special`（filter_type は正しく「ネイル・まつげサロン」で
 * 該当施設が 2 件ある）が filter_keyword「まつ毛 パーマ エクステ」のせいで 0 件になっていた。
 *
 * 全角スペース(U+3000)も区切りにする。日本語入力では全角空白が混ざるのが普通で、
 * 半角だけ見ていると同じ症状が残る。JS の `\s` は U+3000 を含むが、意図を明示するため
 * 文字クラスに書く（SQL 側の `\s` は U+3000 を含まないので、そちらは明示が必須）。
 */
export function keywordTerms(raw: string): string[] {
  return raw
    .slice(0, 100)
    .split(/[\s　]+/)
    .filter((t) => t.length > 0)
    .slice(0, KEYWORD_MAX_TERMS);
}

/** 公開メニューの条件。getFacilityMenus と facility_card_view（coalesce(is_published, true)）に揃える。 */
const PUBLISHED_MENU_FILTER = 'is_published.is.null,is_published.eq.true';

/** 症状名は URL 由来なので長さを切る（マスタの最長は十数文字）。 */
const SYMPTOM_MAX_LENGTH = 50;

/**
 * GPS 検索で詳細条件を確かめるとき、1 回の問い合わせに載せる施設 id の数。
 * id は GET の URL に載るので、1 本あたりの長さを数 KB に抑える（RPC の上限 500 件でも 5 本）。
 */
export const GEO_DETAIL_ID_CHUNK = 100;

type SupabaseAnon = ReturnType<typeof createServerSupabaseClient>;

/** 埋め込み先への条件。列条件（`.filter`）か、埋め込み先に掛ける OR 条件（`.or(…, { referencedTable })`）。 */
type EmbedCondition =
  | { column: string; operator: 'eq' | 'gt' | 'gte' | 'lte'; value: string | number | boolean }
  | { referencedTable: string; or: string };

/** applyDetailFilter が使う PostgREST クエリビルダのメソッド（型引数の異なるビルダを同じ関数で扱う）。 */
interface EmbedFilterable<Q> {
  filter(column: string, operator: string, value: unknown): Q;
  or(filters: string, options?: { referencedTable?: string }): Q;
}

export interface DetailFilter {
  /** select に足す埋め込み（先頭のカンマから。列は返さない空の埋め込み） */
  select: string;
  conditions: EmbedCondition[];
}

/**
 * facility_card_view の 1 行では判定できない条件（メニュー単位・症状）を、facility_card_view からの
 * `!inner` 埋め込みとして組み立てる。条件が無ければ null。
 *
 * 埋め込みは列を返さない（空の埋め込み）ので、結果は施設 1 件につき 1 行のまま、件数（count）も
 * 施設単位になる。DB の中で「条件に合う行を 1 つ以上持つ施設」に絞るので、該当が無ければ 0 件になる
 * （絞り込みなしの全件には戻らない）。複数の条件は施設単位の AND（埋め込みを別々に持つため、
 * 価格帯に入るメニューと保険適用のメニューは別のメニューでよい）。
 *
 * 【2026年10月22日 是正】
 * - 価格帯: 従来は view の min_price >= 下限 かつ max_price <= 上限、つまり【全メニューが範囲内】の
 *   施設しか当たらなかった。公開かつ有料のメニューが 1 つでも [下限, 上限] に入る施設を当てる。
 *   0 円のメニュー（無料カウンセリング等）は数えない。数えると、施術がすべて上限より高い施設まで
 *   あらゆる「〜N円」の検索に出てしまう。
 * - 症状・保険適用: 絞り込みパネルが URL に書いていたのに、検索側が読んでいなかった（無視されていた）。
 * - 🔴 条件に合う施設 id を facility_menus から先に集めて `.in('id', [...])` で渡す作りにはしないこと。
 *   メニュー 1 行ごとに読むので行数上限を超えると検索全体がエラーになり、id の一覧が GET の URL に
 *   載るので数百施設で URL 長の上限（414）に当たる。施設が増えると価格帯検索が必ずエラーになるため、
 *   判定は DB の中で行う（この是正の途中でその形を作り、レビューで差し戻した）。
 */
export function detailFilter(params: SearchParams): DetailFilter | null {
  const embeds: string[] = [];
  const conditions: EmbedCondition[] = [];
  if (params.price_min || params.price_max) {
    embeds.push('price_menu:facility_menus!inner()');
    conditions.push({ column: 'price_menu.price', operator: 'gt', value: 0 });
    if (params.price_min) conditions.push({ column: 'price_menu.price', operator: 'gte', value: params.price_min });
    if (params.price_max) conditions.push({ column: 'price_menu.price', operator: 'lte', value: params.price_max });
    conditions.push({ referencedTable: 'price_menu', or: PUBLISHED_MENU_FILTER });
  }
  if (params.insurance) {
    embeds.push('insurance_menu:facility_menus!inner()');
    conditions.push({ column: 'insurance_menu.insurance_covered', operator: 'eq', value: true });
    conditions.push({ referencedTable: 'insurance_menu', or: PUBLISHED_MENU_FILTER });
  }
  const symptom = params.symptom?.trim().slice(0, SYMPTOM_MAX_LENGTH);
  if (symptom) {
    embeds.push('facility_symptoms!inner(symptoms!inner())');
    conditions.push({ column: 'facility_symptoms.symptoms.name', operator: 'eq', value: symptom });
  }
  if (embeds.length === 0) return null;
  return { select: embeds.map((e) => `, ${e}`).join(''), conditions };
}

function applyDetailFilter<Q extends EmbedFilterable<Q>>(query: Q, detail: DetailFilter): Q {
  let q = query;
  for (const c of detail.conditions) {
    q = 'or' in c ? q.or(c.or, { referencedTable: c.referencedTable }) : q.filter(c.column, c.operator, c.value);
  }
  return q;
}

/**
 * GPS 検索（RPC が詳細条件を受けない）の結果のうち、詳細条件を満たす施設 id。
 * 確かめる id は RPC の結果（上限 500 件）だけなので、URL に載る数は有限で、分割して問い合わせる。
 */
async function facilityIdsMatchingDetail(
  supabase: SupabaseAnon,
  facilityIds: string[],
  detail: DetailFilter,
): Promise<{ ids: Set<string>; error: unknown }> {
  const chunks: string[][] = [];
  for (let i = 0; i < facilityIds.length; i += GEO_DETAIL_ID_CHUNK) {
    chunks.push(facilityIds.slice(i, i + GEO_DETAIL_ID_CHUNK));
  }
  const results = await Promise.all(chunks.map((chunk) =>
    applyDetailFilter(supabase.from(CARD_VIEW).select(`id${detail.select}`).in('id', chunk), detail),
  ));
  const ids = new Set<string>();
  for (const { data, error } of results) {
    if (error) return { ids: new Set(), error };
    for (const row of (data || []) as unknown as { id: string }[]) ids.add(row.id);
  }
  return { ids, error: null };
}

/**
 * 大阪市の区の施設は city に区だけ（北区）を持つ（エリアマスタの単位・src/lib/facility-location.ts）。
 * 表示は「大阪市北区」なので、「大阪市」「大阪市北区」のように表示上の名前で探した人にも見つかるよう、
 * 表示名には含まれるが区の名前そのものには含まれない語を、該当する区の一覧に広げる。
 * 区の名前に含まれる語（北区・北）は従来どおり city.ilike で当たるので広げない（空配列）。
 */
export function osakaWardsForKeyword(term: string): string[] {
  return OSAKA_CITY_WARDS.filter((ward) => !ward.includes(term) && `${OSAKA_CITY}${ward}`.includes(term));
}

export async function searchFacilities(params: SearchParams) {
  const supabase = createServerSupabaseClient();
  const isGeoSearch = params.lat != null && params.lng != null;

  // 価格帯・保険適用・症状（メニュー・症状の単位で判定する条件）。detailFilter を参照。
  const detail = detailFilter(params);

  let query = supabase
    .from(CARD_VIEW)
    .select(
      isGeoSearch ? `${CARD_COLS}, latitude, longitude` : `${CARD_COLS}${detail ? detail.select : ''}`,
      { count: isGeoSearch ? undefined : 'exact' },
    )
    .eq('status', 'published');

  if (params.type) query = query.eq('business_type', params.type);
  if (params.prefecture) query = query.eq('prefecture', params.prefecture);
  if (params.city) query = query.eq('city', params.city);
  if (params.keyword) {
    // LIKE ワイルドカード(% _ \)をエスケープしたうえで、PostgREST の .or() 区切り文字
    // (, ( ) など)の注入を防ぐためパターン全体をダブルクォートで literal 化する
    // （getFeaturedFacilities の orFilterValue と同じ fail-safe 方針）。
    // クォート内でも % / _ は LIKE ワイルドカードとして機能するため、前方/後方一致は維持される。
    // 複数語は AND 意味論（各語がいずれかの列に含まれること）。`.or()` を語ごとに呼ぶと
    // PostgREST 側で or=(…)&or=(…) となり AND で結合される。1つのパターンに連結していた
    // 従来実装は「豊中 まつげ」のような入力が常に 0 件だった（keywordTerms の説明を参照）。
    // 【監査C1・恒久根治 完了】検索対象列は facility_card_view に実在する列のみに限る。
    // かつて nearest_station は view 非射影で、参照すると PostgREST 400→error 握り潰しでキーワード検索
    // が常に0件だった（主要導線の無音全滅）。migration 20260722000002 で facility_card_view に
    // fp.nearest_station を射影したため、access_info（アクセス自由記述）に加え専用列 nearest_station
    // （最寄駅名）も検索対象にでき、GPS 経路(search_facilities_nearby が nearest_station で一致)と
    // 非GPS 経路の駅名検索が対称化する。列は必ず migration 適用後にのみ参照すること。
    for (const term of keywordTerms(params.keyword)) {
      const escaped = term.replace(/[%_\\]/g, '\\$&').replace(/"/g, '\\"');
      const pat = `"%${escaped}%"`;
      // 区名は固定の一覧（OSAKA_CITY_WARDS）から来るので、利用者の入力は .or() の構文に入らない。
      const wards = osakaWardsForKeyword(term);
      const osakaCity = wards.length > 0 ? `,and(prefecture.eq."大阪府",city.in.(${wards.map((ward) => `"${ward}"`).join(',')}))` : '';
      query = query.or(
        `name.ilike.${pat},catch_copy.ilike.${pat},description.ilike.${pat},city.ilike.${pat},access_info.ilike.${pat},nearest_station.ilike.${pat}${osakaCity}`
      );
    }
  }

  if (params.rating_min) query = query.gte('rating_avg', params.rating_min);
  if (params.features && params.features.length > 0) {
    for (const f of params.features) {
      query = query.contains('features', [f]);
    }
  }

  // 【型修正】isGeoSearch は「params.lat != null && params.lng != null」を評価した
  // 結果を保持する真偽値の変数のため、TS の制御フロー解析はこの変数を経由した narrowing を
  // 伝播しない（isGeoSearch が true でも params.lat/params.lng は number | undefined のまま）。
  // as/! で黙らせず、この if 条件に同じ判定を再度書くことで TS に直接 narrowing させる
  // （isGeoSearch が true の場合は必ず両方 non-null なので実行時の意味は変わらない）。
  if (isGeoSearch && params.lat != null && params.lng != null) {
    // Use PostGIS ST_DWithin via RPC for server-side GPS search
    // 【2026年7月10日 恒久根治】keyword/features は RPC が該当列（features・description・
    // nearest_station）を返さないため以前は JS 側で再現できず、GPS 検索でのみ黙って無視
    // されていた（非GPS検索は効くのに GPS 検索だと keyword/features 指定が絞り込みに反映
    // されない確定欠陥）。RPC 側(search_facilities_nearby)を拡張し DB で絞り込むよう根治
    // （migration 20260710000001）。ワイルドカードエスケープは非GPS分岐と同じ方針。
    // 複数語は非GPS分岐と同じ AND 意味論にする。RPC 側（migration 20260812000001）が
    // 受け取った文字列を空白で再分割して全語一致を要求するため、ここでは keywordTerms で
    // 語数上限を適用したうえで半角空白1つで連結して渡す（エスケープは空白を生まないので
    // RPC 側の再分割は同じ語に戻る）。
    const geoTerms = params.keyword ? keywordTerms(params.keyword) : [];
    // 【型修正】RPC の生成型（database.types.ts）では type_filter / keyword_filter /
    // features_filter はいずれも「?: T」（= T | undefined）で、SQL 側の
    // 「DEFAULT NULL」を表している。null は型として受け付けない。
    // supabase-js は .rpc() の引数を JSON.stringify して送るため、値が undefined の
    // キーは JSON 上から消え、PostgREST 側では未指定＝SQL の DEFAULT NULL が使われる。
    // つまり undefined を渡すのは null を渡すのと実行時の意味が同じであり、
    // 単なる型合わせであって挙動は変えていない。
    const escapedKeyword = geoTerms.length
      ? geoTerms.map((t) => t.replace(/[%_\\]/g, '\\$&')).join(' ')
      : undefined;
    const { data, error } = await supabase.rpc('search_facilities_nearby', {
      // 上の if 条件で params.lat / params.lng は number に narrowing 済み。
      user_lat: params.lat,
      user_lng: params.lng,
      radius_km: 10,
      type_filter: params.type || undefined,
      limit_count: 500,
      keyword_filter: escapedKeyword,
      features_filter: params.features && params.features.length > 0 ? params.features : undefined,
    });
    const all = (data || []) as unknown as (FacilityCardData & { distance_km: number })[];
    // GPS 検索は RPC が type_filter/keyword_filter/features_filter 以外を受けないため、
    // 非 GPS 検索で query に付与していた prefecture/city/rating_min が黙って無視されていた
    // （フィルタ指定が効かない）。RPC の返却列に含まれる項目は取得後に同じ意味で絞り込む
    // （非 GPS の .eq/.gte と一致：非 GPS 側は null 値を gte が除外するため、ここでも null は
    // 除外して挙動を揃える）。価格帯・保険適用・症状は非 GPS と同じ埋め込み条件で、
    // RPC の結果に含まれる施設だけを確かめる（facilityIdsMatchingDetail）。
    const nearby = all.filter((f) => {
      if (params.prefecture && f.prefecture !== params.prefecture) return false;
      if (params.city && f.city !== params.city) return false;
      if (params.rating_min && !(f.rating_avg != null && Number(f.rating_avg) >= params.rating_min)) return false;
      return true;
    });
    let filtered = nearby;
    if (detail && nearby.length > 0) {
      const matched = await facilityIdsMatchingDetail(supabase, nearby.map((f) => f.id), detail);
      // 読めなかったときは絞り込みなしの結果を見せず、エラーとして返す（検索ページがエラー表示にする）。
      if (matched.error) return { facilities: [] as FacilityCardData[], total: 0, perPage: PER_PAGE, error: matched.error };
      filtered = nearby.filter((f) => matched.ids.has(f.id));
    }
    const page = Math.max(1, params.page || 1); // 負値(?page=-1 等)で range が負になり PostgREST エラー/末尾slice化するのを防ぐ
    const from = (page - 1) * PER_PAGE;
    const visible = filtered.slice(from, from + PER_PAGE);
    if (visible.length) {
      // The nearby RPC has a fixed return type; read the public schedule facts
      // for just this page without changing the RPC signature.
      const extra = await supabase.from(CARD_VIEW).select('id,special_hours').in('id', visible.map(f => f.id));
      if (extra.error) return { facilities: [] as FacilityCardData[], total: 0, perPage: PER_PAGE, error: extra.error };
      const schedules = new Map((extra.data ?? []).map(row => [row.id, row.special_hours]));
      for (const facility of visible) {
        if (!schedules.has(facility.id)) facility.business_hours = null;
        else facility.special_hours = schedules.get(facility.id) as FacilityCardData['special_hours'];
      }
    }
    return { facilities: visible as FacilityCardData[], total: filtered.length, perPage: PER_PAGE, error };
  }

  if (detail) query = applyDetailFilter(query, detail);

  // 【2026年7月8日 恒久根治】主キー(id)を二次キーとして全ソート分岐に追加する。PostgreSQLは
  // 単一列ORDER BYで同値行の順序を保証しないため、この関数のようにpage/rangeでページングする
  // 場合、同点施設(同一rating_avg等)がページ境界で重複表示・欠落しうる（真の意味で不定であり
  // 稀にしか発生しないバグではなく、実行毎に起こりうる構造的欠陥）。idは一意なため、これを
  // 二次キーにすることで同点内の順序が常に決定的になる。
  if (params.sort === 'rating') {
    query = query.order('rating_avg', { ascending: false }).order('id', { ascending: true });
  } else if (params.sort === 'popular') {
    // facility_card_view に view_count 列は存在しない（列は rating_count / google_review_count 等）。
    // 旧実装は view_count で order しており PostgREST エラー → sort=popular が常に0件だった。
    // 人気の代理指標として rating_count を使う（getPopularFacilities も同じ rating_count 順）。
    query = query.order('rating_count', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false }).order('id', { ascending: true });
  }

  const page = Math.max(1, params.page || 1); // 負値(?page=-1 等)で range が負になり PostgREST エラー/末尾slice化するのを防ぐ
  const from = (page - 1) * PER_PAGE;
  query = query.range(from, from + PER_PAGE - 1);

  const { data, count, error } = await query;
  // 結果より後ろのページ（?page=2 で 3 件しか無い等）を求めると PostgREST は 416
  // （PGRST103 Requested range not satisfiable）を返す。読み取りの失敗ではないので error にしない。
  // 本番では掲載 3 件で /search?page=2 が 500 になっていた（2026年10月22日）。総件数は 416 の応答から
  // 取れないため 0 で返し、呼び出し側（/search）がページ範囲外として 1 ページ目へ戻す。
  if (error?.code === 'PGRST103') {
    return { facilities: [] as FacilityCardData[], total: 0, perPage: PER_PAGE, error: null };
  }
  // 【2026年7月22日 監査C1】検索クエリの error は返り値の error で呼び出し側へ渡す（従来どおり）。
  // 注意：ここで alertCaughtError を per-request に発火させると、公開検索は高トラフィックかつ
  // preview 等の環境要因（anon キー不正 401 等）で全リクエストが失敗し得るため Slack が
  // フラッド（実測200件超）する。無音破綻の検知は外形監視(health-monitor)側に委ね、この
  // ホットパスでは通知しない（列不存在の再発防止は回帰テストと下の access_info 固定で担保）。
  return { facilities: (data || []) as unknown as FacilityCardData[], total: count || 0, perPage: PER_PAGE, error };
}

export async function getPopularFacilities(limit = 6) {
  const cacheKey = `popular_facilities:special-hours-v1:${limit}`;
  try {
    const cached = await cachedFetch<FacilityCardData[]>(
      cacheKey,
      async () => {
        const supabase = createServerSupabaseClient();
        const { data } = await supabase
          .from(CARD_VIEW)
          .select(CARD_COLS)
          .eq('status', 'published')
          // .order('id',...): 主キーを二次キーとして同点施設の順序を決定的にする（恒久根治、
          // 詳細は searchFacilities のコメント参照）。
          .order('rating_count', { ascending: false })
          .order('id', { ascending: true })
          .limit(limit);
        return (data || []) as FacilityCardData[];
      },
      600 // 10 min cache
    );
    return { facilities: cached, error: null };
  } catch {
    // Fallback without cache
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from(CARD_VIEW)
      .select(CARD_COLS)
      .eq('status', 'published')
      .order('rating_count', { ascending: false })
      .order('id', { ascending: true })
      .limit(limit);
    return { facilities: (data || []) as FacilityCardData[], error };
  }
}

// 広告枠: アクティブな上位表示施設を返す（検索1ページ目に差し込む用）
export async function getFeaturedFacilities(businessType?: string, area?: string): Promise<FacilityCardData[]> {
  const supabase = createServerSupabaseClient();
  const now = new Date().toISOString();

  let query = supabase
    .from('featured_slots')
    .select(`facility_id, slot_type, ${CARD_VIEW}(${CARD_COLS})`)
    .eq('is_active', true)
    .eq('slot_type', 'search_top')
    .lte('starts_at', now)
    .gte('ends_at', now)
    .limit(3);

  // PostgREST の .or() フィルタ文字列はユーザー入力（searchParams.type / area）を
  // そのまま埋め込むと "x),status.eq.draft" のようにフィルタ構文を注入できてしまう。
  // 値をダブルクォートで囲み、内部の " と \ をエスケープして literal 化することで
  // PostgREST 演算子・区切り文字の注入を無効化する（fail-safe）。
  const orFilterValue = (v: string) => `"${v.slice(0, 100).replace(/[\\"]/g, '\\$&')}"`;
  if (businessType) query = query.or(`business_type.eq.${orFilterValue(businessType)},business_type.is.null`);
  if (area) query = query.or(`area.eq.${orFilterValue(area)},area.is.null`);

  const { data } = await query;
  return (data || [])
    .map((row: { [key: string]: unknown }) => row[CARD_VIEW])
    .filter(Boolean) as FacilityCardData[];
}

/** 施設の slug（`facility-<uuid>` 等）より十分長い上限。これを超える入力は slug になり得ない。 */
const MAX_SLUG_LENGTH = 200;

/** URL から来た slug を、DB へ問い合わせてよい形か（空・長すぎる・制御文字を含むものは除く）。 */
function isQueryableSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && !/[\u0000-\u001f\u007f]/.test(slug);
}

/**
 * 公開中の施設を slug で 1 件引く。見つからなければ facility は null。
 *
 * 【2026年10月22日 是正】以前は `.single()` の error を呼び出し側が捨てており、DB の一時障害
 * （接続プール枯渇の 504・statement timeout・キー失効の 401 など）でも facility が null になって
 * 公開中の施設ページが「存在しないか、公開が終了した」404＋noindex を返していた
 * （来訪者は閉店と誤解し、クローラは 404 を受け取る）。
 * 0 件は maybeSingle で error にならないので、error は全て「読めなかった」として例外にする
 * （施設ページ・スタッフ・ブログ・カタログ・予約の各ページは error.tsx の一時障害表示になる）。
 *
 * slug になり得ない入力（制御文字を含む・極端に長い）は問い合わせずに「見つからない」にする。
 * そのまま渡すと DB／API 側が入力の誤りとして弾き（/facility/%00 は 22021・長大な URL は 414）、
 * 上の「読めなかった」に入って誰でも 5xx と障害通知を出せてしまう（以前どおり 404 にする）。
 */
export const getFacilityBySlug = cache(async (slug: string) => {
  if (!isQueryableSlug(slug)) return { facility: null };
  const supabase = createServerSupabaseClient();
  const { data } = await readPageResult(() => supabase
    .from('facility_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle(), 'facility-detail');
  return { facility: data as Facility | null };
});

export async function getFacilityMenus(facilityId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_menus')
    .select('*')
    .eq('facility_id', facilityId)
    // 非公開(is_published=false)は客向けに出さない。null/true は従来どおり表示(既存メニュー維持)。
    .or('is_published.is.null,is_published.eq.true')
    .order('sort_order');
  return { menus: (data || []) as FacilityMenu[], error };
}

export async function getFacilityPhotos(facilityId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_photos')
    .select('*')
    .eq('facility_id', facilityId)
    .order('sort_order');
  return { photos: (data || []) as FacilityPhoto[], error };
}

export async function getFacilityReviews(facilityId: string) {
  const supabase = createServerSupabaseClient();
  // `public_reviews` はSupabase型定義に含まれないビューのため
  // 同スキーマの `facility_reviews` にキャストしてSDKの型エラーを回避する。
  // データ型は末尾の `as FacilityReview[]` で保証する。
  const { data, error } = await supabase
    .from('public_reviews' as 'facility_reviews')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });
  return { reviews: (data || []) as FacilityReview[], error };
}

/**
 * 【2026年7月15日 追加】予約確認画面（客向け）にキャンセルポリシーを表示するため、
 * facility_cancel_policies から施設のポリシーを取得する。未設定施設（行が存在しない）は
 * null を返し呼び出し側でグレースフルに非表示にする。取得失敗（DBエラー等）も同様に null を
 * 返し、予約フロー自体をブロックしない（表示専用の付加情報のため）。
 * RLS: `facility_cancel_policies` は "Public read" ポリシー(USING (true))で anon 読み取り可。
 */
export async function getFacilityCancelPolicy(facilityId: string): Promise<CancelPolicy | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_cancel_policies')
    .select('free_cancel_hours, late_cancel_rate, no_show_rate, policy_text, cancel_rule')
    .eq('facility_id', facilityId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CancelPolicy;
}

export async function getSimilarFacilities(facilityId: string, businessType: string, prefecture: string, limit = 4) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .eq('business_type', businessType)
    .eq('prefecture', prefecture)
    .neq('id', facilityId)
    .order('rating_avg', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  return (data || []) as FacilityCardData[];
}

export async function getNearbyFacilities(facilityId: string, prefecture: string, city: string, limit = 4) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .eq('prefecture', prefecture)
    .eq('city', city)
    .neq('id', facilityId)
    .order('rating_avg', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  return (data || []) as FacilityCardData[];
}

export async function getLatestFacilities(limit = 6) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  return { facilities: (data || []) as FacilityCardData[], error };
}

/**
 * 実際に公開施設が存在する都道府県・業種を返す（検索0件時の再検索候補に使う）。
 *
 * 【2026年7月28日・恒久是正】検索0件画面は「人気の検索」として東京都・愛知県・福岡県・
 * 神奈川県などを固定表示していたが、これらのエリアには実際には掲載施設が1件も無く、
 * 押しても再び0件になる（0件→0件の連鎖で離脱する）状態だった。
 * 候補をハードコードする限り掲載実態と必ずいつか乖離するため、DB から実在する値だけを
 * 引く構造にして、乖離する経路そのものを断つ。
 */
export async function getAvailableAreasAndTypes(): Promise<{ areas: string[]; types: string[] }> {
  const timeoutMs = 5_000;

  let timer!: ReturnType<typeof setTimeout>;

  try {
    // Preview has no Supabase credentials. Client initialization can throw too;
    // optional area/type suggestions must not prevent the page from rendering.
    const supabase = createServerSupabaseClient();
    const query = supabase
      .from(CARD_VIEW)
      .select('prefecture, business_type')
      .eq('status', 'published');

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`getAvailableAreasAndTypes timeout ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const { data, error } = await Promise.race([
      Promise.resolve(query),
      timeout,
    ]);

    if (error) {
      console.error('[facilities] getAvailableAreasAndTypes failed:', error.message);
      return { areas: [], types: [] };
    }

    const rows = (data || []) as {
      prefecture: string | null;
      business_type: string | null;
    }[];

    // null / 空文字を候補に出すとリンク先が壊れるため除外する。
    const areas = [
      ...new Set(
        rows
          .map((r) => r.prefecture)
          .filter((v): v is string => !!v),
      ),
    ];

    const types = [
      ...new Set(
        rows
          .map((r) => r.business_type)
          .filter((v): v is string => !!v),
      ),
    ];

    return { areas, types };
  } catch (error) {
    console.error(
      '[facilities] getAvailableAreasAndTypes failed:',
      error instanceof Error ? error.message : String(error),
    );

    return { areas: [], types: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** 空き判定で読む facility_card_view の列（isCardBookingReady の入力＋営業時間）。 */
export const BOOKING_READINESS_COLS = 'id, name, prefecture, city, business_hours, photo_count, booking_menu_count, active_staff_count, has_address';

type ReadinessCard = Parameters<typeof isCardBookingReady>[0] & { id: string };

/** business_hours のキー（0=日曜。dayOfWeekUtc と同じ並び）。 */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const CLOCK_TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;
const WHOLE_DAY = { start: 0, end: 24 * 60 };

/**
 * その曜日の営業窓（0 時からの分）。予約枠 RPC get_available_slots と同じ解釈にする。
 * - business_hours 未設定・object 以外・曜日キーなし → 制限しない
 * - 曜日キーが null → 定休日（null を返す）
 * - { open, close } → 勤務時間をこの範囲に切り詰める（形式が読めない値は制限しない）
 */
export function facilityOpenWindow(businessHours: unknown, dayOfWeek: number): { start: number; end: number } | null {
  if (!businessHours || typeof businessHours !== 'object' || Array.isArray(businessHours)) return WHOLE_DAY;
  const hours = businessHours as Record<string, unknown>;
  const key = WEEKDAY_KEYS[dayOfWeek];
  if (!Object.prototype.hasOwnProperty.call(hours, key)) return WHOLE_DAY;
  const day = hours[key];
  if (day === null) return null;
  const { open, close } = (typeof day === 'object' ? day : {}) as { open?: unknown; close?: unknown };
  if (typeof open !== 'string' || typeof close !== 'string' || !CLOCK_TIME.test(open) || !CLOCK_TIME.test(close)) {
    return WHOLE_DAY;
  }
  return { start: timeToMinutes(open), end: timeToMinutes(close) };
}

/** 予約枠 RPC（get_available_slots）が枠の開始時刻を並べる間隔（分）。 */
export const SLOT_STEP_MINUTES = 30;

/**
 * 1 人のスタッフに、予約画面で選べる枠が 1 つでもあるか（分単位の純粋関数）。
 * 予約枠 RPC get_available_slots と同じ並べ方をする：勤務の開始（営業時間で切り詰めた後）から
 * 30 分おきに、所要時間ぶん勤務内に収まる枠を並べ、予約（前後のバッファ込み）と重なる枠を除く。
 * 当日は空き枠 API（dropStartedSlotsToday）と同じく、開始時刻が今より後の枠だけを数える。
 * 時間帯の指定があれば、その時間帯に始まる枠だけを数える。
 */
export function hasBookableSlot(p: {
  workStart: number;
  workEnd: number;
  /** 枠の長さ（分）。施設の予約できるメニューのうち最短の所要時間。 */
  duration: number;
  /** 予約の前後に空ける時間（分・facility_profiles.booking_buffer_minutes）。 */
  buffer: number;
  bookings: { start: number; end: number }[];
  /** 当日のとき、この秒（0 時から）以前に始まる枠は数えない。当日以外は null。 */
  notAfterSeconds: number | null;
  /** 時間帯（午前など）の指定。この範囲 [start, end) に始まる枠だけを数える。 */
  startWindow: { start: number; end: number } | null;
}): boolean {
  for (let start = p.workStart; p.workEnd - start >= p.duration; start += SLOT_STEP_MINUTES) {
    if (p.notAfterSeconds !== null && start * 60 <= p.notAfterSeconds) continue;
    if (p.startWindow && (start < p.startWindow.start || start >= p.startWindow.end)) continue;
    const end = start + p.duration;
    if (!p.bookings.some((b) => b.start < end + p.buffer && b.end + p.buffer > start)) return true;
  }
  return false;
}

/**
 * 指定日（・時間帯）に空きのある施設 id。
 *
 * null は「判定できなかった」（URL の日付が読めない・どれかの読み取りに失敗した）。呼び出し側は
 * 空きの表示を出さないこと。空集合を返すと全施設に「空きなし」と出て、満席だと誤って伝えてしまう。
 *
 * 【2026年10月23日 是正】「空きあり」は予約画面で実際に選べる枠があるときだけ出す。以前は勤務時間と
 * 予約の合計分数だけを比べていたため、次の 2 つを空きとして数えていた。
 *  - 当日の過ぎた時間（夜 21 時台でも、その日の 9〜19 時営業の店に「空きあり」が出た。予約画面は
 *    開始済みの枠を出さないので、当日は全部 × だった）
 *  - 予約の間の細切れの隙間（30 分しか空いていなくても、最短 60 分のメニューしかない店や、
 *    予約の前後に空ける時間を設定している店では予約画面に枠が出ない）
 * 枠の並べ方は hasBookableSlot（予約枠 RPC と同じ）、枠の長さは施設の予約できるメニューのうち最短の
 * 所要時間（予約画面と同じ式＝booking-slot-rules）。過ぎた日付には空きを出さない。
 * ⚠️ 担当者の決まっていない旧い予約による容量の判定と、メニュー担当スタッフ制（menu_staff）は見ない
 * （どちらも本番では行が無い）。
 */
export async function getAvailableFacilityIds(
  facilityIds: string[],
  dateStr: string,
  timeSlot?: string,
  nowMs: number = Date.now(),
): Promise<Set<string> | null> {
  if (facilityIds.length === 0) return new Set();
  // A missing private read must never become a false "available"/"full" result.
  if (isPublicReadOnlyPreview()) return null;
  const dayOfWeek = dayOfWeekUtc(dateStr); // 0=Sun（TZ非依存・admin-date 単一ソース）
  if (Number.isNaN(dayOfWeek)) return null; // 日付として読めない URL 値
  // JST の今日と、今日の 0 時からの経過秒（当日の過ぎた枠を数えないため）。
  const jstNow = new Date(nowMs + 9 * 3_600_000);
  const todayStr = jstNow.toISOString().slice(0, 10);
  if (dateStr < todayStr) return new Set(); // 過ぎた日は予約できない
  const notAfterSeconds = dateStr === todayStr
    ? jstNow.getUTCHours() * 3600 + jstNow.getUTCMinutes() * 60 + jstNow.getUTCSeconds()
    : null;
  const supabase = createServerSupabaseClient();

  // 0. ネット予約を受け付けられる施設と、その日の営業時間。
  // 【2026年10月22日 是正】従来はスタッフの勤務と予約だけを見ていたため、定休日（business_hours の
  // 曜日が null）でもスタッフの週間シフトがあれば「空きあり」と出し、営業時間外の勤務も空きに
  // 数えていた。予約準備が整っていない施設（施設ページでネット予約を断る施設）にも出ていた。
  // 予約枠 RPC get_available_slots は facility_booking_ready と営業時間で枠を出さないので、
  // 同じ条件（isCardBookingReady＝施設ページ・「予約OK」バッジと同じ規則）で揃える。
  const { data: cards, error: cardsError } = await supabase
    .from(CARD_VIEW)
    .select(BOOKING_READINESS_COLS)
    .in('id', facilityIds);
  if (cardsError) return null;
  const openWindows = new Map<string, MinuteWindow[]>();
  for (const card of (cards || []) as unknown as ReadinessCard[]) {
    if (!isCardBookingReady(card)) continue;
    const windows = businessWindows(card.business_hours, dayOfWeek);
    if (windows.length > 0) openWindows.set(card.id, windows);
  }
  if (openWindows.size === 0) return new Set();
  const bookableIds = [...openWindows.keys()];

  // 0b. 枠の長さ（予約できるメニューのうち最短の所要時間）と、予約の前後に空ける時間。
  // メニューは予約画面・予約準備の判定と同じく、非公開（is_published=false）以外を数える。
  const [menusRead, buffersRead] = await Promise.all([
    supabase
      .from('facility_menus')
      .select('facility_id, duration_minutes')
      .in('facility_id', bookableIds)
      .or('is_published.is.null,is_published.eq.true'),
    supabase
      .from('facility_profiles')
      .select('id, booking_buffer_minutes')
      .in('id', bookableIds),
  ]);
  if (menusRead.error || buffersRead.error) return null;
  const shortestMenu = new Map<string, number>();
  for (const menu of menusRead.data || []) {
    const minutes = bookingDurationForMenus([menu]);
    const current = shortestMenu.get(menu.facility_id);
    if (current === undefined || minutes < current) shortestMenu.set(menu.facility_id, minutes);
  }
  const bufferMinutes = new Map<string, number>();
  for (const profile of buffersRead.data || []) bufferMinutes.set(profile.id, profile.booking_buffer_minutes ?? 0);

  // 1. Get staff schedules for this day of week
  const { data: staffSchedules, error: schedulesError } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .eq('day_of_week', dayOfWeek);
  if (schedulesError) return null;

  // 2. Get staff → facility mapping
  const { data: staffProfiles, error: staffError } = await supabase
    .from('staff_profiles')
    .select('id, facility_id')
    .eq('is_active', true)
    .in('facility_id', bookableIds);
  if (staffError) return null;

  if (!staffProfiles || staffProfiles.length === 0) return new Set();

  const staffToFacility = new Map<string, string>();
  for (const sp of staffProfiles) {
    staffToFacility.set(sp.id, sp.facility_id);
  }
  const staffIds = staffProfiles.map((s) => s.id);

  // 3. Check schedule overrides (holidays)
  const { data: overrides, error: overridesError } = await supabase
    .from('schedule_overrides')
    .select('staff_id, is_holiday, start_time, end_time')
    .eq('date', dateStr)
    .in('staff_id', staffIds);
  // 休みの上書きを読めないと、休みのスタッフを空きに数えてしまう。
  if (overridesError) return null;

  const holidayStaff = new Set<string>();
  const overrideMap = new Map<string, ScheduleOverride>();
  for (const o of overrides || []) {
    if (o.is_holiday) {
      holidayStaff.add(o.staff_id);
    } else {
      overrideMap.set(o.staff_id, o as ScheduleOverride);
    }
  }

  // 4. Get existing bookings for this date
  // 【2026年7月16日 恒久根治・#483/#484同型】bookings の SELECT RLS は
  // auth.uid()=user_id（＋施設メンバー限定）のためanonクライアントでは常に0行になり、
  // 満席の枠まで「空きあり」と誤判定していた（本番実測で確認）。bookings 読み取りのみ
  // service role で行う（他クエリ（staff_schedules/staff_profiles/schedule_overrides）は
  // 公開データのため anon のまま変更しない）。取得列は既存どおり（PII非含有）。
  const serviceRoleSupabase = createServiceRoleClient();
  const { data: bookings, error: bookingsError } = await serviceRoleSupabase
    .from('bookings')
    .select('staff_id, booking_date, start_time, end_time')
    .in('booking_date', [addDays(dateStr, -1), dateStr, addDays(dateStr, 1)])
    // 枠を占有する全状態（pending/confirmed/arrived/completed）。arrived（来店中）/ completed
    // （同日施術済）を取りこぼすと、その枠を「空きあり」と過大表示し RPC の実占有と乖離する。
    .in('status', SLOT_OCCUPYING_STATUSES)
    .in('facility_id', bookableIds);
  // 予約を読めないと、満席の枠を空きありと出してしまう。
  if (bookingsError) return null;

  const staffBookings = new Map<string, { start: number; end: number }[]>();
  for (const b of bookings || []) {
    if (!b.staff_id) continue;
    const list = staffBookings.get(b.staff_id) || [];
    const offset = b.booking_date ? (Date.parse(b.booking_date) - Date.parse(dateStr)) / 60_000 : 0;
    list.push({ start: offset + timeToMinutes(b.start_time), end: offset + timeToMinutes(b.end_time) });
    staffBookings.set(b.staff_id, list);
  }

  // 5. Determine time range filter（その時間帯に始まる枠を数える）
  let startWindow: { start: number; end: number } | null = null;
  if (timeSlot === 'morning') startWindow = { start: 9 * 60, end: 12 * 60 };
  else if (timeSlot === 'afternoon') startWindow = { start: 12 * 60, end: 17 * 60 };
  else if (timeSlot === 'evening') startWindow = { start: 17 * 60, end: 23 * 60 };

  // 6. Check each staff for availability
  const scheduleMap = new Map<string, { start: string; end: string }>();
  for (const s of staffSchedules || []) {
    scheduleMap.set(s.staff_id, { start: s.start_time, end: s.end_time });
  }

  const availableFacilities = new Set<string>();

  for (const staffId of staffIds) {
    if (holidayStaff.has(staffId)) continue;
    const facilityId = staffToFacility.get(staffId);
    if (!facilityId || availableFacilities.has(facilityId)) continue;
    // staff_profiles は bookableIds で絞ってあるので通常は必ず見つかる。見つからなければ
    // 予約を受け付けない施設のスタッフとして扱う（空きありを出さない側に倒す）。
    const open = openWindows.get(facilityId);
    if (!open) continue;

    // Determine working hours
    const override = overrideMap.get(staffId);
    const schedule = scheduleMap.get(staffId);
    const workStart = override?.start_time || schedule?.start;
    const workEnd = override?.end_time || schedule?.end;
    if (!workStart || !workEnd) continue;

    // 勤務時間は施設の営業時間に切り詰める（get_available_slots と同じ。勤務が営業時間の外に
    // はみ出していても、その部分は予約枠にならない）。
    // 【2026年7月9日 恒久根治】時間帯の指定は、その時間帯の空きだけを見る（午前が満枠・午後が空きの
    // スタッフを午前の検索で「空きあり」にしない）。今は「その時間帯に始まる枠」で判定する。
    const bookable = open.some(window => hasBookableSlot({
      workStart: Math.max(timeToMinutes(workStart), window.start),
      workEnd: Math.min(timeToMinutes(workEnd), window.end),
      duration: shortestMenu.get(facilityId) ?? MENU_DURATION_FALLBACK_MINUTES,
      buffer: bufferMinutes.get(facilityId) ?? 0,
      bookings: staffBookings.get(staffId) || [],
      notAfterSeconds,
      startWindow,
    }));
    if (bookable) availableFacilities.add(facilityId);
  }

  return availableFacilities;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export async function getMonthlyBookingCounts(facilityIds: string[]): Promise<Record<string, number>> {
  if (facilityIds.length === 0) return {};
  // Omit this optional badge when private booking data is unavailable. Public
  // search still uses anon/RLS; never substitute anon for the private read.
  if (isPublicReadOnlyPreview()) return {};
  // 【2026年7月16日 恒久根治・#483/#484同型】bookings の SELECT RLS は
  // auth.uid()=user_id（＋施設メンバー限定）のためanonクライアントでは常に0行になり、
  // 「今月N件予約」バッジが全店で非表示になっていた（本番実測で確認）。この関数は
  // bookings 集計のみを行うため service role クライアントに置き換える。取得列は
  // facility_id のみ（PII非含有）。
  const supabase = createServiceRoleClient({ reuseReadConnections: true });
  // 「今月」は JST 暦月で判定する。サーバ(UTC)で now.getMonth() を使うと
  // JST 月初早朝（JST 1日 00:00〜08:59 = UTC 前月末日 15:00〜23:59）にまだ前月扱いになり、
  // 「今月の予約数」が前月分を集計してしまう。admin-date の単一ソースで JST 月境界に統一する。
  const cur = jstMonthInfo(0);
  const monthStart = `${cur.year}-${String(cur.month).padStart(2, '0')}-01`;
  const next = jstMonthInfo(1);
  const nextMonth = `${next.year}-${String(next.month).padStart(2, '0')}-01`;

  const { data } = await supabase
    .from('bookings')
    .select('facility_id')
    .in('facility_id', facilityIds)
    // 占有集合（pending/confirmed/arrived/completed）。arrived の取りこぼしで月間予約数を過少集計しない。
    .in('status', SLOT_OCCUPYING_STATUSES)
    .gte('booking_date', monthStart)
    .lt('booking_date', nextMonth);

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.facility_id] = (counts[row.facility_id] || 0) + 1;
  }
  return counts;
}
