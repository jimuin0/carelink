import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bookingReadinessChecks, listingPrTextMissing, summarizeWorkingStaff, workingStaffQuery, type ReadinessKey,
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

export type SetupStepKey = 'address' | 'pr_text' | 'publish' | 'menu' | 'staff' | 'photo' | 'hours' | 'schedule';

export interface FacilitySetupFacts {
  name: string | null;
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
   * 有効スタッフのうち、勤務時間が無い人（週間の勤務日も、今日以降に勤務する特別日も無い）。
   * 予約枠が1つも出ない。判定は workingStaffQuery（予約枠・公開カードと同じ規則）。
   */
  unscheduledStaffIds: string[];
}

export interface FacilitySetupStep {
  key: SetupStepKey;
  label: string;
  done: boolean;
  href: string;
  /** listing＝無料掲載の公開に要る項目。booking＝ネット予約を受けるのに要る項目（掲載だけなら不要）。 */
  group: 'listing' | 'booking';
}

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
  return [
    { key: 'address', label: '基本情報（住所）', done: ok('name', 'prefecture', 'city', 'address'), href: '/admin/settings', group: 'listing' },
    { key: 'pr_text', label: '基本情報（キャッチコピー・施設紹介の表現）', done: prTextOk, href: '/admin/settings', group: 'listing' },
    { key: 'publish', label: '無料掲載を公開', done: ok('published'), href: '/admin/settings', group: 'listing' },
    { key: 'menu', label: 'ネット予約：公開メニュー登録', done: ok('menu'), href: '/admin/menus', group: 'booking' },
    // 予約を受けられるのは勤務時間を保存したスタッフだけ（追加しただけでは勤務は作られない）。
    { key: 'staff', label: 'ネット予約：スタッフ登録と勤務時間の保存', done: ok('staff'), href: '/admin/staff', group: 'booking' },
    { key: 'photo', label: 'ネット予約：写真アップロード', done: ok('photo'), href: '/admin/photos', group: 'booking' },
    { key: 'hours', label: 'ネット予約：営業時間の確認・保存', done: ok('hours'), href: '/admin/settings', group: 'booking' },
    // 有効スタッフ全員に勤務時間があって初めて完了にする（1人でも未登録ならその人には予約が入らない）。
    {
      key: 'schedule', label: '予約枠：勤務スケジュール設定',
      done: facts.activeStaffIds.length > 0 && facts.unscheduledStaffIds.length === 0,
      href: '/admin/staff', group: 'booking',
    },
  ];
}

/** 読み取りを包む関数（ページは時間制限つきの読み取りを渡す）。 */
export type SetupReader = <Q extends PromiseLike<unknown>>(label: string, query: Q) => Promise<Awaited<Q>>;
const directRead: SetupReader = (_label, query) => Promise.resolve(query);

/** 店舗セットアップの判定材料。どれか1つでも読めなければ例外（0件・未設定に偽装しない）。 */
export async function loadFacilitySetupFacts(client: SupabaseClient, facilityId: string, read: SetupReader = directRead): Promise<FacilitySetupFacts> {
  const [menus, staff, photos, profile] = await Promise.all([
    read('menus', client.from('facility_menus').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).or('is_published.is.null,is_published.eq.true')),
    read('staff', workingStaffQuery(client, facilityId)),
    read('photos', client.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId)),
    read('facility', client.from('facility_profiles')
      .select('name, prefecture, city, address, catch_copy, description, business_hours, status').eq('id', facilityId).single()),
  ]);
  const failure = menus.error ?? staff.error ?? photos.error ?? profile.error;
  if (failure) throw new Error(`店舗セットアップの状況を取得できませんでした: ${failure.message}`);

  const { activeIds, workingIds } = summarizeWorkingStaff(staff.data);
  const row = (profile.data ?? {}) as {
    name?: string | null; prefecture?: string | null; city?: string | null; address?: string | null;
    catch_copy?: string | null; description?: string | null; business_hours?: unknown; status?: string | null;
  };
  return {
    name: row.name ?? null,
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
