import { businessWindows } from './business-hours';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasConfirmedBookingHours } from './booking-preparation';
import { validateFacilityPrText } from './medical-ad-guard';
import { todayJst } from './admin-date';
import { BOOKING_DURATION_MAX_MINUTES, BOOKING_DURATION_MIN_MINUTES, bookingDurationForMenus } from './booking-slot-rules';

export interface PublishReadiness {
  ready: boolean;
  missing: string[];
}

function isPublishedInvariantConflict(error: unknown, name: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === '23514' && typeof value.message === 'string'
    && value.message.includes(`"${name}"`);
}

/** Only this known DB invariant is an actionable conflict, not any DB error. */
export function isPublishedLocationConflict(error: unknown): boolean {
  return isPublishedInvariantConflict(error, 'published_facility_location_present');
}

/**
 * 公開（下書き・休止から公開へ）か、公開中の営業時間の変更で、曜日別の営業時間が確認済みでないと
 * DB（update_facility_settings_atomic / set_facilities_publication_atomic・migration 20261023170000）が
 * 返す衝突。アプリの公開ゲートを通った後に営業時間が変わった場合だけ起きる。
 */
export function isPublishedHoursConflict(error: unknown): boolean {
  return isPublishedInvariantConflict(error, 'published_facility_hours_confirmed');
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** SQL 側（working_time_meets_business_hours）と同じ時刻の形：H:MM / HH:MM、秒は任意。 */
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function clockSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (value === '24:00' || value === '24:00:00') return 86400;
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : null;
}

/**
 * 店舗で予約画面が求めうる最短の所要時間（分）。予約できるメニュー（非公開以外）1つずつの
 * bookingDurationForMenus（未設定・0 は 60 分、15〜480 分に丸める）の最小値。予約できるメニューが
 * 無ければ 15 分（空き枠 RPC が受け付ける最短）。SQL 側は public.facility_shortest_booking_minutes
 * （migration 20261023190000）。ここを変えるときは必ず両方を揃える。
 */
export function shortestBookingMinutes(menus: unknown): number {
  const list = (Array.isArray(menus) ? menus : []) as { duration_minutes?: number | null }[];
  if (list.length === 0) return BOOKING_DURATION_MIN_MINUTES;
  return Math.min(...list.map(menu => bookingDurationForMenus([menu])));
}

/**
 * 予約できるメニュー（公開側 getFacilityMenus と同じ可視条件＝is_published が null または true）の
 * 所要時間。件数（count）も一緒に返す。最短の所要時間は shortestBookingMinutes で求める。
 */
export function bookableMenusQuery(client: SupabaseClient, facilityId: string) {
  return client
    .from('facility_menus')
    .select('duration_minutes', { count: 'exact' })
    .eq('facility_id', facilityId)
    .or('is_published.is.null,is_published.eq.true');
}

/**
 * 勤務の窓（週間の勤務日、または勤務する特別日）が、その曜日の店舗の営業時間の中に
 * minMinutes 分（店舗の最短のメニュー・既定 15 分）以上残るか。
 *
 * 予約枠（get_available_slots）は勤務の窓を営業時間で切り詰め、定休日は枠を出さない。営業時間の外に
 * しか勤務が無いスタッフしかいない店舗は、検索カードは「予約OK」なのに予約画面は毎日「満枠」になっていた
 * （2026年10月23日）。SQL 側の同じ規則は public.working_time_meets_business_hours（migration
 * 20261023180000）。ここを変えるときは必ず両方を揃える。
 *
 * 営業時間の読み方は get_available_slots と同じ：未設定・オブジェクトでない・その曜日のキーが無い→
 * 切り詰めない／その曜日が null→定休日（勤務の窓は残らない）／open・close が両方あれば切り詰める。
 * 読めない時刻（HH:MM[:SS] でない）は、予約枠も出せないので「残らない」とする。
 *
 * 残る長さは店舗の最短のメニュー以上を要る（migration 20261023190000）。予約枠は切り詰めた窓に
 * 所要時間がまるごと入るときだけ出るため、数分だけ重なるスタッフしかいない店舗は「予約OK」なのに
 * 毎日「満枠」になっていた。minMinutes は 15〜480 分に丸める（SQL 側と同じ）。
 */
export function workingTimeMeetsBusinessHours(
  hours: unknown, dayOfWeek: number, start: unknown, end: unknown, minMinutes: number = BOOKING_DURATION_MIN_MINUTES,
): boolean {
  const from = clockSeconds(start);
  const to = clockSeconds(end);
  if (from === null || to === null || WEEKDAY_KEYS[dayOfWeek] === undefined) return false;
  const need = Math.min(Math.max(Number.isFinite(minMinutes) ? minMinutes : BOOKING_DURATION_MIN_MINUTES,
    BOOKING_DURATION_MIN_MINUTES), BOOKING_DURATION_MAX_MINUTES);
  return businessWindows(hours, dayOfWeek).some(window =>
    Math.min(to, window.end * 60) - Math.max(from, window.start * 60) >= need * 60);

}

/** 'YYYY-MM-DD' の曜日（0=日）。読めない日付は -1（どの曜日の営業時間にも当たらない）。 */
function weekdayOf(date: unknown): number {
  const day = typeof date === 'string' ? new Date(`${date}T00:00:00Z`).getUTCDay() : Number.NaN;
  return Number.isNaN(day) ? -1 : day;
}

/**
 * 在籍（is_active）スタッフを、勤務の窓つきで読むクエリ。
 *
 * 予約枠（get_available_slots）は、週間の勤務日か、今日以降に勤務する特別日（休みではなく
 * 開始・終了時刻がある日）の中で、しかも店舗の営業時間の中にしか出ない。スタッフを追加しただけでは
 * 勤務は作られないため（migration 20261023080100）、「有効スタッフがいる」だけで予約できる店舗として扱うと、
 * 検索カードは「予約OK」なのに予約画面は毎日「満枠」になる。SQL 側の同じ規則は
 * public.staff_has_working_time（facility_booking_ready と facility_card_view.active_staff_count
 * が使う・migration 20261023080000 / 20261023180000）。ここを変えるときは必ず両方を揃える。
 *
 * 埋め込みの絞り込みは子の行だけを絞る（スタッフ自体は全員返る）。営業時間と重なるかは
 * summarizeWorkingStaff が窓ごとに確かめるので、窓は全部読む（最初の 1 行が営業時間外でも、
 * 後の行が重なれば予約を受けられる）。
 */
export function workingStaffQuery(client: SupabaseClient, facilityId: string, today: string = todayJst()) {
  return client
    .from('staff_profiles')
    .select('id, staff_schedules(day_of_week, start_time, end_time), schedule_overrides(date, start_time, end_time)')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .gte('schedule_overrides.date', today)
    .not('schedule_overrides.is_holiday', 'is', true)
    .not('schedule_overrides.start_time', 'is', null)
    .not('schedule_overrides.end_time', 'is', null);
}

export interface WorkingStaff {
  /** 在籍スタッフ全員。 */
  activeIds: string[];
  /** そのうち営業時間の中に最短のメニュー以上の勤務の窓がある（予約を受けられる）スタッフ。 */
  workingIds: Set<string>;
  /** 勤務の窓は保存してあるが、どれも営業時間（定休日を含む）の中に最短のメニュー以上残らないスタッフ。 */
  outsideHoursIds: Set<string>;
}

type WindowRow = { day_of_week?: unknown; date?: unknown; start_time?: unknown; end_time?: unknown };

/**
 * workingStaffQuery の結果を、在籍スタッフ・予約を受けられるスタッフ・営業時間の外にしか勤務が無い
 * スタッフに分ける。businessHours は facility_profiles.business_hours（読めなければ null＝切り詰めない。
 * SQL 側で施設が見えないときと同じ）。minMinutes は店舗の最短のメニュー（shortestBookingMinutes）。
 */
export function summarizeWorkingStaff(
  rows: unknown, businessHours: unknown, minMinutes: number = BOOKING_DURATION_MIN_MINUTES,
): WorkingStaff {
  const list = (Array.isArray(rows) ? rows : []) as {
    id: string; staff_schedules?: WindowRow[] | null; schedule_overrides?: WindowRow[] | null;
  }[];
  const workingIds = new Set<string>();
  const outsideHoursIds = new Set<string>();
  for (const row of list) {
    const weekly = row.staff_schedules ?? [];
    const special = row.schedule_overrides ?? [];
    const works = weekly.some(w => workingTimeMeetsBusinessHours(businessHours, Number(w.day_of_week), w.start_time, w.end_time, minMinutes))
      || special.some(o => workingTimeMeetsBusinessHours(businessHours, weekdayOf(o.date), o.start_time, o.end_time, minMinutes));
    if (works) workingIds.add(row.id);
    else if (weekly.length + special.length > 0) outsideHoursIds.add(row.id);
  }
  return { activeIds: list.map(row => row.id), workingIds, outsideHoursIds };
}

/**
 * 在籍スタッフと、そのうち予約を受けられるスタッフ。読めなければ例外にする
 * （読めないことを「勤務未登録」と取り違えて、誤った案内や警告を出さないため）。
 * 営業時間はこのクライアントで読める施設の行から取る（SQL 側の staff_has_working_time と同じ）。
 */
export async function readWorkingStaff(client: SupabaseClient, facilityId: string): Promise<WorkingStaff> {
  const [staff, facility, menus] = await Promise.all([
    workingStaffQuery(client, facilityId),
    client.from('facility_profiles').select('business_hours').eq('id', facilityId).limit(1),
    bookableMenusQuery(client, facilityId),
  ]);
  const error = staff.error ?? facility.error ?? menus.error;
  if (error) throw new Error(`スタッフの勤務状況を取得できませんでした: ${error.message}`);
  const hours = (facility.data as { business_hours?: unknown }[] | null)?.[0]?.business_hours;
  return summarizeWorkingStaff(staff.data, hours ?? null, shortestBookingMinutes(menus.data));
}

/**
 * ネット予約の準備条件。掲載公開の条件とは分離する。
 *
 * メニュー件数は公開側 getFacilityMenus の可視条件(is_published が null または true)と揃える。
 * HPB 反映メニューは is_published=false(下書き)で作られるため、これを数に含めると
 * 「公開メニュー0件なのにネット予約できてしまう」行き止まりを防ぐ。
 * スタッフは営業時間の中に勤務時間がある在籍スタッフだけを数える（workingStaffQuery・summarizeWorkingStaff）。
 *
 * error を握り潰すと DB 障害時に「未充足」と誤判定して予約を不当に拒否/許可しかねないため、
 * 呼び出し側が 500 で顕在化できるよう error を返す。
 */
export async function checkBookingReadiness(
  admin: SupabaseClient,
  facilityId: string
): Promise<{ readiness: PublishReadiness; error: unknown }> {
  const [menu, photo, staff, profile] = await Promise.all([
    // 件数と、勤務の窓に要る長さ（最短のメニュー）を同じ読み取りで取る。
    bookableMenusQuery(admin, facilityId),
    admin
      .from('facility_photos')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId),
    workingStaffQuery(admin, facilityId),
    // 掲載の所在地と公開状態も確認するが、メニュー等はネット予約だけの条件。
    admin
      .from('facility_profiles')
      .select('name, prefecture, city, address, business_hours, status')
      .eq('id', facilityId)
      .single(),
  ]);

  if (menu.error || photo.error || staff.error || profile.error) {
    return {
      readiness: { ready: false, missing: [] },
      error: menu.error ?? photo.error ?? staff.error ?? profile.error,
    };
  }

  const missing = bookingReadinessMissing({
    name: profile.data?.name,
    prefecture: profile.data?.prefecture,
    city: profile.data?.city,
    hasAddress: Boolean(profile.data?.address?.trim()),
    status: profile.data?.status,
    businessHours: profile.data?.business_hours,
    menuCount: menu.count ?? 0,
    photoCount: photo.count ?? 0,
    workingStaffCount: summarizeWorkingStaff(staff.data, profile.data?.business_hours ?? null,
      shortestBookingMinutes(menu.data)).workingIds.size,
  });
  return { readiness: { ready: missing.length === 0, missing }, error: null };
}

export interface BookingReadinessInput {
  name?: string | null;
  prefecture?: string | null;
  city?: string | null;
  hasAddress: boolean;
  status?: string | null;
  businessHours?: unknown;
  menuCount: number;
  photoCount: number;
  /** 営業時間の中に勤務時間がある在籍スタッフの数（summarizeWorkingStaff / facility_card_view.active_staff_count）。 */
  workingStaffCount: number;
}

/** 個々の条件の識別子。店舗セットアップ（/admin のチェックリスト・登録3日後のメール）が
 * どの条件を満たしたかを、文言ではなくキーで引けるようにする。 */
export type ReadinessKey = 'name' | 'prefecture' | 'city' | 'address' | 'menu' | 'photo' | 'staff' | 'published' | 'hours';

export interface ReadinessCheck {
  key: ReadinessKey;
  ok: boolean;
  /** 満たしていないときにオーナーへ見せる文言。 */
  message: string;
}

type LocationKey = 'name' | 'prefecture' | 'city' | 'address';

/** 掲載に要る施設名・所在地。公開ゲートとネット予約の両方がここを通る（判定も文言も1か所）。 */
function locationChecks(input: { name?: string | null; prefecture?: string | null; city?: string | null; hasAddress: boolean }): Record<LocationKey, ReadinessCheck> {
  return {
    name: { key: 'name', ok: Boolean(input.name?.trim()), message: '施設名を設定してください' },
    prefecture: { key: 'prefecture', ok: Boolean(input.prefecture?.trim()), message: '都道府県を設定してください' },
    city: { key: 'city', ok: Boolean(input.city?.trim()), message: '市区町村を設定してください' },
    // 下書きでは所在地未入力を許容するが、来店先が分からない状態で公開しない。
    address: { key: 'address', ok: input.hasAddress, message: '住所を設定してください' },
  };
}

/** 営業時間が足りないときにオーナーへ見せる文言（公開ゲート・ネット予約・チェックリストで共通）。 */
export const LISTING_HOURS_MESSAGE = '全曜日の営業時間・定休日を確認して保存してください';

/**
 * 曜日別の営業時間・定休日が保存済みか（SQL 側は public.confirmed_booking_hours）。
 * 無料掲載の公開とネット予約の両方の条件（2026年10月23日 神原さん決定で掲載にも必須化）。
 * 判定も文言も 1 か所。
 */
function hoursCheck(businessHours: unknown): ReadinessCheck {
  return { key: 'hours', ok: hasConfirmedBookingHours(businessHours), message: LISTING_HOURS_MESSAGE };
}

/**
 * The single online-booking rule, one entry per condition. The booking page,
 * the slot APIs, the search card's 「予約OK」 badge and the owner's setup
 * checklist (dashboard and the day-3 follow-up email) all read it.
 */
export function bookingReadinessChecks(input: BookingReadinessInput): ReadinessCheck[] {
  const location = locationChecks(input);
  return [
    location.name,
    { key: 'menu', ok: input.menuCount >= 1, message: 'メニューを1つ以上登録してください' },
    { key: 'photo', ok: input.photoCount >= 1, message: '写真を1枚以上登録してください' },
    { key: 'staff', ok: input.workingStaffCount >= 1, message: '営業時間内の勤務時間を保存したスタッフを1人以上登録してください' },
    location.prefecture,
    location.city,
    location.address,
    { key: 'published', ok: input.status === 'published', message: '店舗を掲載公開してください' },
    hoursCheck(input.businessHours),
  ];
}

/**
 * The single online-booking rule. The booking page, the slot APIs and the
 * search card's 「予約OK」 badge all use it, so a card can never advertise
 * booking that the facility page then refuses.
 */
export function bookingReadinessMissing(input: BookingReadinessInput): string[] {
  return bookingReadinessChecks(input).filter(check => !check.ok).map(check => check.message);
}

/**
 * A search card is advertised as bookable only when facility_card_view carries
 * the readiness inputs and they satisfy the same rule. Cards built from sources
 * without those inputs are never advertised (fail closed, no false 「予約OK」).
 * active_staff_count counts only active staff with working time inside the business hours
 * (public.staff_has_working_time, migration 20261023080000).
 */
export function isCardBookingReady(card: {
  name: string; prefecture: string; city: string; business_hours: unknown; photo_count: number;
  booking_menu_count?: number | null; active_staff_count?: number | null; has_address?: boolean | null;
}): boolean {
  if (card.booking_menu_count == null || card.active_staff_count == null || card.has_address == null) return false;
  return bookingReadinessMissing({
    name: card.name, prefecture: card.prefecture, city: card.city, hasAddress: card.has_address,
    status: 'published', businessHours: card.business_hours,
    menuCount: card.booking_menu_count, photoCount: card.photo_count, workingStaffCount: card.active_staff_count,
  }).length === 0;
}

/** 公開ゲートで医療広告の表現を見直す PR 文言の列と、オーナーに見せる欄名。 */
const PR_TEXT_FIELDS = [['catch_copy', 'キャッチコピー'], ['description', '施設紹介']] as const;

export interface ListingValues {
  name?: string | null;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
  catch_copy?: string | null;
  description?: string | null;
}

/** 公開ゲートが読む営業時間（未保存は null／undefined）。 */
export interface ListingPublishValues extends ListingValues {
  /**
   * facility_profiles.business_hours。必須キーにしてあるのは、渡し忘れた呼び出し側が
   * 「営業時間なし」で黙って通る／黙って断られることを型で防ぐため。
   */
  business_hours: unknown;
}

/** 掲載公開に要る営業時間が欠けていれば、その文言（ネット予約の判定と同じ規則・同じ文言）。 */
export function listingHoursMissing(businessHours: unknown): string[] {
  const check = hoursCheck(businessHours);
  return check.ok ? [] : [check.message];
}

/** 掲載公開に要る施設名・所在地のうち欠けているもの（ネット予約の判定と同じ規則・同じ文言）。 */
export function listingLocationMissing(values: ListingValues): string[] {
  const location = locationChecks({ ...values, hasAddress: Boolean(values.address?.trim()) });
  return [location.name, location.prefecture, location.city, location.address]
    .filter(check => !check.ok).map(check => check.message);
}

/**
 * 公開を止める PR 文言（キャッチコピー・施設紹介）の表現。
 * 最後の砦。/admin/settings は保存時に弾くが、/register の PR 文（取り込み後は施設紹介）など
 * 設定画面を経ずに入った文言は検査されないまま公開できた。公開の瞬間にも同じ判定を通す。
 */
export function listingPrTextMissing(values: ListingValues): string[] {
  const missing: string[] = [];
  for (const [field, label] of PR_TEXT_FIELDS) {
    const check = validateFacilityPrText(values[field]);
    if (!check.ok) missing.push(`${label}：${check.message}`);
  }
  return missing;
}

/**
 * The single listing-publish rule. The server gate runs it on the saved row,
 * the settings page runs it on what the owner sees before saving, and the owner's
 * setup checklist (dashboard and day-3 email) is built from its parts, so none
 * of them can name different missing items.
 *
 * 店舗情報（施設名・所在地・PR 文言の表現）→ 曜日別の営業時間、の順（チェックリストの並びと同じ）。
 * 営業時間は 2026年10月23日の神原さん決定で無料掲載にも必須になった（それまではネット予約だけの条件）。
 * DB 側の最終ゲートは update_facility_settings_atomic / set_facilities_publication_atomic
 * （migration 20261023170000・public.confirmed_booking_hours）。
 */
export function listingPublishMissing(values: ListingPublishValues): string[] {
  return [...listingLocationMissing(values), ...listingPrTextMissing(values), ...listingHoursMissing(values.business_hours)];
}

/** Listing is independent of online booking. Authorization stays in the caller. */
export async function checkPublishReadiness(admin: SupabaseClient, facilityId: string): Promise<{ readiness: PublishReadiness; error: unknown }> {
  const profile = await admin.from('facility_profiles').select('name, prefecture, city, address, catch_copy, description, business_hours').eq('id', facilityId).single();
  if (profile.error) return { readiness: { ready: false, missing: [] }, error: profile.error };
  const missing = listingPublishMissing({ ...profile.data, business_hours: profile.data?.business_hours ?? null });
  return { readiness: { ready: missing.length === 0, missing }, error: null };
}
