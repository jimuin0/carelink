import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bookableMenusQuery, bookingReadinessChecks, listingPrTextMissing, shortestBookingMinutes, summarizeWorkingStaff, workingStaffQuery, type ReadinessKey,
} from './facility-publish-gate';

/**
 * 店舗セットアップ（/admin のチェックリストと、登録3日後のフォローメール）の単一ソース。
 *
 * 以前はダッシュボードとフォローメールがそれぞれ別の条件で「未設定項目」を数えていた。
 * メールだけ住所・営業時間を見ておらず、下書きのメニューや休止中のスタッフを
 * 「登録済み」と数えていたため、公開もネット予約もできない店舗に
 * 「あとは公開するだけ」と案内していた。完了の判定は公開ゲート（listingPublishMissing の
 * 所在地・PR 文言）とネット予約の判定（bookingReadinessChecks）から引き、ここで二重に持たない。
 */

export type SetupStepKey = 'address' | 'pr_text' | 'publish' | 'hours' | 'menu' | 'photo' | 'staff';

export interface FacilitySetupFacts {
  name: string | null;
  /** 公開ページ（/facility/[slug]）の行き先。公開後に「掲載ページを見る」を出すために使う。 */
  slug: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  /** 公開ゲートが医療広告の表現を検査する PR 文言。 */
  catchCopy: string | null;
  description: string | null;
  status: string | null;
  businessHours: unknown;
  /** 公開メニュー（is_published が null か true）の件数。ネット予約の判定と同じ数え方。 */
  publishedMenuCount: number;
  photoCount: number;
  /** 有効（is_active）スタッフ。休止中のスタッフは予約を受けないので数えない。 */
  activeStaffIds: string[];
  /**
   * 有効スタッフのうち、営業時間の中に勤務時間が無い人（週間の勤務日も、今日以降に勤務する特別日も
   * 無いか、あってもすべて営業時間の外・定休日）。予約枠が1つも出ない。判定は summarizeWorkingStaff
   * （予約枠・公開カードと同じ規則）。
   */
  unscheduledStaffIds: string[];
}

export type SetupStepGroup = 'listing' | 'booking';

export interface FacilitySetupStep {
  key: SetupStepKey;
  label: string;
  done: boolean;
  href: string;
  /**
   * listing＝無料掲載の公開に要る項目（店舗情報・営業時間・公開）。
   * booking＝ネット予約を受けるのに要る項目（掲載だけなら不要）。
   */
  group: SetupStepGroup;
  /**
   * 完了の判定には影響しない補足（例：勤務時間が未登録のスタッフの人数）。
   * 任意項目が未入力のときは optional を立てる（「完了」と見せず「任意・未入力」と見せる）。
   */
  note?: string;
  optional?: boolean;
}

/** ダッシュボードの見出し。区分ごとに進み具合を分けて出す（掲載だけの利用も正常な運用）。 */
export const SETUP_GROUP_LABELS: Record<SetupStepGroup, string> = {
  listing: '無料掲載に必要',
  booking: 'ネット予約に必要（任意）',
};

/**
 * 並びは依存の順（先に済ませないと次が進められないものを前に置く）。
 * 掲載：店舗情報 → 営業時間 → 公開。ネット予約：メニュー → 写真 → スタッフと勤務時間。
 * 営業時間は 2026年10月23日の神原さん決定で無料掲載の公開条件になった（公開ゲート listingPublishMissing と
 * DB の公開 RPC が同じ規則で断る）。それまではネット予約の区分にあり、営業時間が無いまま公開できていた。
 * 営業時間はネット予約の条件でもあり、スタッフの勤務時間の下書きも店舗の営業時間から作るため、
 * 掲載の区分に置くことでネット予約の各項目より必ず前に来る（以前はスタッフの後にあり、
 * スタッフを追加すると「店舗の営業時間がまだ保存されていない」と差し戻されていた）。
 *
 * 「スタッフ登録と勤務時間の保存」と「勤務スケジュール設定」は同じ作業の二重掲載だったので 1 項目にした。
 * 完了は予約の判定と同じく「勤務時間のあるスタッフが1人以上」。勤務時間が未登録のスタッフは補足で知らせる
 * （予約を受けないスタッフがいても、そのスタッフのせいで永久に未完了にはしない）。
 */
export function facilitySetupSteps(facts: FacilitySetupFacts): FacilitySetupStep[] {
  const checks = bookingReadinessChecks({
    name: facts.name,
    prefecture: facts.prefecture,
    city: facts.city,
    hasAddress: Boolean(facts.address?.trim()),
    status: facts.status,
    businessHours: facts.businessHours,
    menuCount: facts.publishedMenuCount,
    photoCount: facts.photoCount,
    workingStaffCount: facts.activeStaffIds.length - facts.unscheduledStaffIds.length,
  });
  const ok = (...keys: ReadinessKey[]) => keys.every(key => checks.some(check => check.key === key && check.ok));
  // 公開ゲートは所在地に加えて PR 文言の表現も見る（/register から取り込んだ文言は設定画面を経ていない）。
  // ここを見ないと「あとは公開するだけ」と案内した直後に公開を拒否される。
  const prTextOk = listingPrTextMissing({ catch_copy: facts.catchCopy, description: facts.description }).length === 0;
  // 空の PR 文言は公開を止めないが、「完了」と見せると入力済みと誤解させる。任意・未入力として見せる。
  const prTextEmpty = !facts.catchCopy?.trim() && !facts.description?.trim();
  const unscheduled = facts.unscheduledStaffIds.length;
  return [
    { key: 'address', label: '基本情報（住所）', done: ok('name', 'prefecture', 'city', 'address'), href: '/admin/settings', group: 'listing' },
    {
      key: 'pr_text', label: '基本情報（キャッチコピー・施設紹介の表現）', done: prTextOk, href: '/admin/settings', group: 'listing',
      ...(prTextOk && prTextEmpty ? { optional: true, note: '任意・未入力' } : {}),
    },
    { key: 'hours', label: '営業時間の入力・保存', done: ok('hours'), href: '/admin/settings', group: 'listing' },
    { key: 'publish', label: '無料掲載を公開', done: ok('published'), href: '/admin/settings', group: 'listing' },
    { key: 'menu', label: '公開メニュー登録', done: ok('menu'), href: '/admin/menus', group: 'booking' },
    { key: 'photo', label: '写真アップロード', done: ok('photo'), href: '/admin/photos', group: 'booking' },
    // 予約を受けられるのは勤務時間を保存したスタッフだけ（追加しただけでは勤務は作られない）。
    {
      key: 'staff', label: 'スタッフ登録と勤務時間の保存', done: ok('staff'), href: '/admin/staff', group: 'booking',
      ...(unscheduled > 0 ? { note: `勤務時間が未登録か営業時間外で予約を受けられないスタッフ：${unscheduled}人` } : {}),
    },
  ];
}

/**
 * 各項目の操作手順。/admin/manual の「初期設定」はこれと facilitySetupSteps の並び・見出しから組み立てる。
 *
 * 以前のマニュアルは手書きで、実際の画面と食い違っていた（写真「5枚以上」＝実際は1枚、存在しない
 * 「設定 → 公開設定 → 公開中」、スタッフ追加に無い入力欄、実在しないボタン名）。チェックリストと
 * 同じ項目・同じ順で出すことで、項目を足し替えたときにマニュアルだけ古くなることを無くす。
 * Record にしてあるので、項目を足すと手順を書くまで型検査が通らない。
 * ボタン名・欄名は画面の表記そのまま（src/app/admin/__tests__/manual-help-copy.test.ts が実在を確かめる）。
 */
export const SETUP_STEP_HOWTO: Record<SetupStepKey, string> = {
  address: '「設定」の「基本情報」で施設名、「所在地」で都道府県・市区町村・町名・番地を入力し、「保存する」を押します。',
  pr_text: '「設定」の「基本情報」でキャッチコピー・施設紹介を入力できます（任意）。効果を保証する表現（「必ず治る」等）や他店との比較（「日本一」等）は公開できないため、保存・公開のときに直す箇所が表示されます。',
  hours: '「設定」の「営業時間」で、営業する曜日の開店・閉店時間を入力し、休みの曜日は「営業」のチェックを外して「保存する」を押します。',
  publish: '「設定」の画面上部の「公開する」を押します（保存していない入力があるときは「保存して公開する」）。足りない項目があれば、その場に一覧が出ます。公開後は同じ場所の「非公開にする」で、いつでも掲載を止められます。',
  menu: '「メニュー」の「メニュー追加」で、カテゴリ・メニュー名・料金・所要時間を入力して「保存」を押します。ホットペッパービューティーから取り込んだメニューは非公開で作られるので、「公開する」を押してください。',
  photo: '「写真」で種類を選び、「写真を選択（複数可）」から1枚以上アップロードします（JPG・PNG・WebP。5MBを超える写真は自動で縮小します）。',
  staff: '「スタッフ」の「追加」で名前などを入力して「スタッフを追加」を押すと、勤務時間の画面に進みます。曜日ごとの勤務時間を確かめて「この勤務時間で保存する」を押すまで、そのスタッフはネット予約を受けられません。',
};

export interface SetupGuideStep {
  key: SetupStepKey;
  label: string;
  group: SetupStepGroup;
  howto: string;
}

/** 手順の判定に使わない空の店舗（並び・見出し・区分だけを facilitySetupSteps から借りる）。 */
const BLANK_FACTS: FacilitySetupFacts = {
  name: null, slug: null, prefecture: null, city: null, address: null, catchCopy: null, description: null,
  status: null, businessHours: null, publishedMenuCount: 0, photoCount: 0, activeStaffIds: [], unscheduledStaffIds: [],
};

/** マニュアル用の手順一覧。並び・見出し・区分はチェックリストと同じ（ここで二重に持たない）。 */
export function setupGuideSteps(): SetupGuideStep[] {
  return facilitySetupSteps(BLANK_FACTS).map(({ key, label, group }) => ({ key, label, group, howto: SETUP_STEP_HOWTO[key] }));
}

/** 読み取りを包む関数（ページは時間制限つきの読み取りを渡す）。 */
export type SetupReader = <Q extends PromiseLike<unknown>>(label: string, query: Q) => Promise<Awaited<Q>>;
const directRead: SetupReader = (_label, query) => Promise.resolve(query);

/** 店舗セットアップの判定材料。どれか1つでも読めなければ例外（0件・未設定に偽装しない）。 */
export async function loadFacilitySetupFacts(client: SupabaseClient, facilityId: string, read: SetupReader = directRead): Promise<FacilitySetupFacts> {
  const [menus, staff, photos, profile] = await Promise.all([
    // 件数と、勤務の窓に要る長さ（最短のメニュー・shortestBookingMinutes）を同じ読み取りで取る。
    read('menus', bookableMenusQuery(client, facilityId)),
    read('staff', workingStaffQuery(client, facilityId)),
    read('photos', client.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId)),
    read('facility', client.from('facility_profiles')
      .select('name, slug, prefecture, city, address, catch_copy, description, business_hours, status').eq('id', facilityId).single()),
  ]);
  const failure = menus.error ?? staff.error ?? photos.error ?? profile.error;
  if (failure) throw new Error(`店舗セットアップの状況を取得できませんでした: ${failure.message}`);

  const row = (profile.data ?? {}) as {
    name?: string | null; slug?: string | null; prefecture?: string | null; city?: string | null; address?: string | null;
    catch_copy?: string | null; description?: string | null; business_hours?: unknown; status?: string | null;
  };
  // 勤務の窓が営業時間と重なるかは、この店舗の営業時間で確かめる（予約枠・検索カードと同じ規則）。
  const { activeIds, workingIds } = summarizeWorkingStaff(staff.data, row.business_hours ?? null, shortestBookingMinutes(menus.data));
  return {
    name: row.name ?? null,
    slug: row.slug ?? null,
    prefecture: row.prefecture ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    catchCopy: row.catch_copy ?? null,
    description: row.description ?? null,
    status: row.status ?? null,
    businessHours: row.business_hours ?? null,
    publishedMenuCount: menus.count ?? 0,
    photoCount: photos.count ?? 0,
    activeStaffIds: activeIds,
    unscheduledStaffIds: activeIds.filter(id => !workingIds.has(id)),
  };
}
