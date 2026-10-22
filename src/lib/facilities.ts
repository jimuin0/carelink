import { cache } from 'react';
import { createServerSupabaseClient, createServiceRoleClient } from './supabase-server';
import type { Facility, FacilityCardData, FacilityMenu, FacilityPhoto, FacilityReview, SearchParams, ScheduleOverride } from '@/types';
import { cachedFetch } from './redis';
import { jstMonthInfo, dayOfWeekUtc } from './admin-date';
import { SLOT_OCCUPYING_STATUSES } from './booking-status';
import type { CancelPolicy } from './cancel-fee';
import { fetchAllPaged } from './paginate';
import { isCardBookingReady } from './facility-publish-gate';

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
export const CARD_COLS = 'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, google_rating, google_review_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count, booking_menu_count, active_staff_count, has_address';

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
 * 施設 id の先行抽出で読む行数の上限。超えたら打ち切らずにエラーとして返す
 * （一部だけで絞り込むと、該当する施設を黙って落とすため）。
 */
const DETAIL_FILTER_MAX_ROWS = 20_000;

type SupabaseAnon = ReturnType<typeof createServerSupabaseClient>;
type FacilityIdPage = { data: { facility_id: string }[] | null; error: unknown };
type FacilityIdLookup = { ids: Set<string>; error: unknown };

async function collectFacilityIds(
  fetchPage: (offset: number, limit: number) => PromiseLike<FacilityIdPage>,
): Promise<FacilityIdLookup> {
  const { rows, error } = await fetchAllPaged((offset, limit) => Promise.resolve(fetchPage(offset, limit)), {
    maxRows: DETAIL_FILTER_MAX_ROWS,
    failOnTruncation: true,
  });
  return { ids: new Set(rows.map((r) => r.facility_id)), error };
}

async function symptomFacilityIds(supabase: SupabaseAnon, name: string): Promise<FacilityIdLookup> {
  const { data, error } = await supabase.from('symptoms').select('id').eq('name', name).maybeSingle();
  if (error || !data) return { ids: new Set(), error };
  return collectFacilityIds((offset, limit) =>
    supabase.from('facility_symptoms').select('facility_id').eq('symptom_id', data.id).range(offset, offset + limit - 1),
  );
}

/**
 * facility_card_view の 1 行では判定できない条件（メニュー単位・症状）に合う施設 id を集める。
 * ids=null は「この種の条件が指定されていない（絞り込まない）」、空集合は「該当 0 件」。
 *
 * 【2026年10月22日 是正】
 * - 価格帯: 従来は view の min_price >= 下限 かつ max_price <= 上限、つまり【全メニューが範囲内】の
 *   施設しか当たらなかった。メニューが 1 つでも範囲外にあると、範囲内のメニューを持っていても
 *   消えていた。公開かつ価格のあるメニュー（view の min/max と同じ対象）が 1 つでも
 *   [下限, 上限] に入る施設を当てる。gte/lte は price が NULL の行を落とすので「価格あり」も満たす。
 * - 症状・保険適用: 絞り込みパネルが URL に書いていたのに、検索側が読んでいなかった（無視されていた）。
 * 複数の条件は施設単位の AND（それぞれを満たす施設の共通部分）。
 */
async function detailFilterFacilityIds(
  supabase: SupabaseAnon,
  params: SearchParams,
): Promise<{ ids: Set<string> | null; error: unknown }> {
  const lookups: Promise<FacilityIdLookup>[] = [];
  if (params.price_min || params.price_max) {
    lookups.push(collectFacilityIds((offset, limit) => {
      let q = supabase.from('facility_menus').select('facility_id').or(PUBLISHED_MENU_FILTER);
      if (params.price_min) q = q.gte('price', params.price_min);
      if (params.price_max) q = q.lte('price', params.price_max);
      return q.range(offset, offset + limit - 1);
    }));
  }
  if (params.insurance) {
    lookups.push(collectFacilityIds((offset, limit) =>
      supabase
        .from('facility_menus')
        .select('facility_id')
        .eq('insurance_covered', true)
        .or(PUBLISHED_MENU_FILTER)
        .range(offset, offset + limit - 1),
    ));
  }
  const symptom = params.symptom?.trim().slice(0, SYMPTOM_MAX_LENGTH);
  if (symptom) lookups.push(symptomFacilityIds(supabase, symptom));
  if (lookups.length === 0) return { ids: null, error: null };

  const results = await Promise.all(lookups);
  const failed = results.find((r) => r.error);
  if (failed) return { ids: null, error: failed.error };
  const [first, ...rest] = results;
  const ids = new Set([...first.ids].filter((id) => rest.every((r) => r.ids.has(id))));
  return { ids, error: null };
}

export async function searchFacilities(params: SearchParams) {
  const supabase = createServerSupabaseClient();
  const isGeoSearch = params.lat != null && params.lng != null;

  // 価格帯・保険適用・症状は先に施設 id を絞る。読めなかったときは「絞り込みなし」に倒さず
  // エラーとして返し、該当が無いときは 0 件を返す（どちらも全件を見せない）。
  const detail = await detailFilterFacilityIds(supabase, params);
  if (detail.error || (detail.ids && detail.ids.size === 0)) {
    return { facilities: [] as FacilityCardData[], total: 0, perPage: PER_PAGE, error: detail.error };
  }
  const restrictIds = detail.ids;

  let query = supabase
    .from(CARD_VIEW)
    .select(isGeoSearch ? `${CARD_COLS}, latitude, longitude` : CARD_COLS, { count: isGeoSearch ? undefined : 'exact' })
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
      query = query.or(
        `name.ilike.${pat},catch_copy.ilike.${pat},description.ilike.${pat},city.ilike.${pat},access_info.ilike.${pat},nearest_station.ilike.${pat}`
      );
    }
  }

  if (params.rating_min) query = query.gte('rating_avg', params.rating_min);
  if (restrictIds) query = query.in('id', [...restrictIds]);
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
    // 除外して挙動を揃える）。価格帯・保険適用・症状は非 GPS と同じ先行抽出した id 集合で絞る。
    const filtered = all.filter((f) => {
      if (params.prefecture && f.prefecture !== params.prefecture) return false;
      if (params.city && f.city !== params.city) return false;
      if (params.rating_min && !(f.rating_avg != null && Number(f.rating_avg) >= params.rating_min)) return false;
      if (restrictIds && !restrictIds.has(f.id)) return false;
      return true;
    });
    const page = Math.max(1, params.page || 1); // 負値(?page=-1 等)で range が負になり PostgREST エラー/末尾slice化するのを防ぐ
    const from = (page - 1) * PER_PAGE;
    return { facilities: filtered.slice(from, from + PER_PAGE) as FacilityCardData[], total: filtered.length, perPage: PER_PAGE, error };
  }

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
  // 【2026年7月22日 監査C1】検索クエリの error は返り値の error で呼び出し側へ渡す（従来どおり）。
  // 注意：ここで alertCaughtError を per-request に発火させると、公開検索は高トラフィックかつ
  // preview 等の環境要因（anon キー不正 401 等）で全リクエストが失敗し得るため Slack が
  // フラッド（実測200件超）する。無音破綻の検知は外形監視(health-monitor)側に委ね、この
  // ホットパスでは通知しない（列不存在の再発防止は回帰テストと下の access_info 固定で担保）。
  return { facilities: (data || []) as unknown as FacilityCardData[], total: count || 0, perPage: PER_PAGE, error };
}

export async function getPopularFacilities(limit = 6) {
  const cacheKey = `popular_facilities:${limit}`;
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

export const getFacilityBySlug = cache(async (slug: string) => {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();
  return { facility: data as Facility | null, error };
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
    .select('free_cancel_hours, late_cancel_rate, no_show_rate, policy_text')
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
  const supabase = createServerSupabaseClient();
  const timeoutMs = 5_000;

  let timer!: ReturnType<typeof setTimeout>;

  try {
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

// Check which facilities have availability on a given date/time
export async function getAvailableFacilityIds(
  facilityIds: string[],
  dateStr: string,
  timeSlot?: string
): Promise<Set<string>> {
  if (facilityIds.length === 0) return new Set();
  const dayOfWeek = dayOfWeekUtc(dateStr); // 0=Sun（TZ非依存・admin-date 単一ソース）
  if (Number.isNaN(dayOfWeek)) return new Set(); // 日付として読めない URL 値
  const supabase = createServerSupabaseClient();

  // 0. ネット予約を受け付けられる施設と、その日の営業時間。
  // 【2026年10月22日 是正】従来はスタッフの勤務と予約だけを見ていたため、定休日（business_hours の
  // 曜日が null）でもスタッフの週間シフトがあれば「空きあり」と出し、営業時間外の勤務も空きに
  // 数えていた。予約準備が整っていない施設（施設ページでネット予約を断る施設）にも出ていた。
  // 予約枠 RPC get_available_slots は facility_booking_ready と営業時間で枠を出さないので、
  // 同じ条件（isCardBookingReady＝施設ページ・「予約OK」バッジと同じ規則）で揃える。
  const { data: cards } = await supabase
    .from(CARD_VIEW)
    .select(BOOKING_READINESS_COLS)
    .in('id', facilityIds);
  const openWindows = new Map<string, { start: number; end: number }>();
  for (const card of (cards || []) as unknown as ReadinessCard[]) {
    if (!isCardBookingReady(card)) continue;
    const openWindow = facilityOpenWindow(card.business_hours, dayOfWeek);
    if (openWindow) openWindows.set(card.id, openWindow);
  }
  if (openWindows.size === 0) return new Set();
  const bookableIds = [...openWindows.keys()];

  // 1. Get staff schedules for this day of week
  const { data: staffSchedules } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .eq('day_of_week', dayOfWeek);

  // 2. Get staff → facility mapping
  const { data: staffProfiles } = await supabase
    .from('staff_profiles')
    .select('id, facility_id')
    .eq('is_active', true)
    .in('facility_id', bookableIds);

  if (!staffProfiles || staffProfiles.length === 0) return new Set();

  const staffToFacility = new Map<string, string>();
  for (const sp of staffProfiles) {
    staffToFacility.set(sp.id, sp.facility_id);
  }
  const staffIds = staffProfiles.map((s) => s.id);

  // 3. Check schedule overrides (holidays)
  const { data: overrides } = await supabase
    .from('schedule_overrides')
    .select('staff_id, is_holiday, start_time, end_time')
    .eq('date', dateStr)
    .in('staff_id', staffIds);

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
  const { data: bookings } = await serviceRoleSupabase
    .from('bookings')
    .select('staff_id, start_time, end_time')
    .eq('booking_date', dateStr)
    // 枠を占有する全状態（pending/confirmed/arrived/completed）。arrived（来店中）/ completed
    // （同日施術済）を取りこぼすと、その枠を「空きあり」と過大表示し RPC の実占有と乖離する。
    .in('status', SLOT_OCCUPYING_STATUSES)
    .in('facility_id', bookableIds);

  const staffBookings = new Map<string, { start: string; end: string }[]>();
  for (const b of bookings || []) {
    if (!b.staff_id) continue;
    const list = staffBookings.get(b.staff_id) || [];
    list.push({ start: b.start_time, end: b.end_time });
    staffBookings.set(b.staff_id, list);
  }

  // 5. Determine time range filter
  let filterStart: string | null = null;
  let filterEnd: string | null = null;
  if (timeSlot === 'morning') { filterStart = '09:00'; filterEnd = '12:00'; }
  else if (timeSlot === 'afternoon') { filterStart = '12:00'; filterEnd = '17:00'; }
  else if (timeSlot === 'evening') { filterStart = '17:00'; filterEnd = '23:00'; }

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

    // Determine the effective availability window.
    // 勤務時間は施設の営業時間に切り詰める（get_available_slots と同じ。勤務が営業時間の外に
    // はみ出していても、その部分は予約枠にならない）。
    // 時間帯フィルタ指定時は「勤務時間 ∩ 要求ウィンドウ」の交差区間で判定する。
    // 【2026年7月9日 恒久根治】旧実装は勤務と要求時間帯が重なるスタッフを除外はするが、
    // 空き判定を1日全体（workMinutes=全勤務・bookedMinutes=全予約）で行っていたため、
    // 「09:00-18:00 勤務で午前(09-12)が満枠・午後は空き」のスタッフが morning 検索でも
    // 「空きあり」と誤表示された（要求時間帯外の空きを数えていた）。勤務・予約の双方を
    // 要求ウィンドウにクリップして、その時間帯内に空きがあるかだけを見る。
    let winStart = Math.max(timeToMinutes(workStart), open.start);
    let winEnd = Math.min(timeToMinutes(workEnd), open.end);
    if (filterStart && filterEnd) {
      winStart = Math.max(winStart, timeToMinutes(filterStart));
      winEnd = Math.min(winEnd, timeToMinutes(filterEnd));
    }
    const workMinutes = winEnd - winStart;
    // 勤務が要求時間帯と重ならない（交差が0以下）スタッフはこの時間帯では対象外。
    if (workMinutes <= 0) continue;

    // Check if at least one slot is free within the window（各予約もウィンドウにクリップ）。
    const existingBookings = staffBookings.get(staffId) || [];
    const bookedMinutes = existingBookings.reduce((sum, b) => {
      const bStart = Math.max(timeToMinutes(b.start), winStart);
      const bEnd = Math.min(timeToMinutes(b.end), winEnd);
      return sum + Math.max(0, bEnd - bStart);
    }, 0);
    if (bookedMinutes < workMinutes) {
      availableFacilities.add(facilityId);
    }
  }

  return availableFacilities;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export async function getMonthlyBookingCounts(facilityIds: string[]): Promise<Record<string, number>> {
  if (facilityIds.length === 0) return {};
  // 【2026年7月16日 恒久根治・#483/#484同型】bookings の SELECT RLS は
  // auth.uid()=user_id（＋施設メンバー限定）のためanonクライアントでは常に0行になり、
  // 「今月N件予約」バッジが全店で非表示になっていた（本番実測で確認）。この関数は
  // bookings 集計のみを行うため service role クライアントに置き換える。取得列は
  // facility_id のみ（PII非含有）。
  const supabase = createServiceRoleClient();
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
