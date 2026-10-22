import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingReadinessChecks, type ReadinessKey } from './facility-publish-gate';

/**
 * 店舗セットアップ（/admin のチェックリストと、登録3日後のフォローメール）の単一ソース。
 *
 * 以前はダッシュボードとフォローメールがそれぞれ別の条件で「未設定項目」を数えていた。
 * メールだけ住所・営業時間を見ておらず、下書きのメニューや休止中のスタッフを
 * 「登録済み」と数えていたため、公開もネット予約もできない店舗に
 * 「あとは公開するだけ」と案内していた。完了の判定は公開ゲート・ネット予約の判定
 * （facility-publish-gate.ts の bookingReadinessChecks）から引き、ここで二重に持たない。
 */

export type SetupStepKey = 'address' | 'publish' | 'menu' | 'staff' | 'photo' | 'hours' | 'schedule';

export interface FacilitySetupFacts {
  name: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  status: string | null;
  businessHours: unknown;
  /** 公開メニュー（is_published が null か true）の件数。ネット予約の判定と同じ数え方。 */
  publishedMenuCount: number;
  photoCount: number;
  /** 有効（is_active）スタッフ。休止中のスタッフは予約を受けないので数えない。 */
  activeStaffIds: string[];
  /** 有効スタッフのうち、週間の勤務日が1日も保存されていない人。予約枠が1つも出ない。 */
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
    staffCount: facts.activeStaffIds.length,
  });
  const ok = (...keys: ReadinessKey[]) => keys.every(key => checks.some(check => check.key === key && check.ok));
  return [
    { key: 'address', label: '基本情報（住所）', done: ok('name', 'prefecture', 'city', 'address'), href: '/admin/settings', group: 'listing' },
    { key: 'publish', label: '無料掲載を公開', done: ok('published'), href: '/admin/settings', group: 'listing' },
    { key: 'menu', label: 'ネット予約：公開メニュー登録', done: ok('menu'), href: '/admin/menus', group: 'booking' },
    { key: 'staff', label: 'ネット予約：有効スタッフ登録', done: ok('staff'), href: '/admin/staff', group: 'booking' },
    { key: 'photo', label: 'ネット予約：写真アップロード', done: ok('photo'), href: '/admin/photos', group: 'booking' },
    { key: 'hours', label: 'ネット予約：営業時間の確認・保存', done: ok('hours'), href: '/admin/settings', group: 'booking' },
    // スタッフを追加しただけでは勤務は作られない（オーナーが勤務時間を保存するまで予約枠は出ない）。
    // 有効スタッフ全員が勤務日を保存して初めて完了にする。
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

/**
 * 勤務日を1日以上保存済みのスタッフ。読めなければ例外にする（読めないことを「未設定」と
 * 取り違えて、誤った案内やチェックリストを出さないため）。
 */
export async function loadScheduledStaffIds(client: SupabaseClient, staffIds: string[], read: SetupReader = directRead): Promise<Set<string>> {
  if (staffIds.length === 0) return new Set();
  const { data, error } = await read('schedules', client.from('staff_schedules').select('staff_id').in('staff_id', staffIds));
  if (error) throw new Error(`勤務スケジュールの取得に失敗しました: ${error.message}`);
  return new Set(((data ?? []) as { staff_id: string }[]).map(row => row.staff_id));
}

/** 店舗セットアップの判定材料。どれか1つでも読めなければ例外（0件・未設定に偽装しない）。 */
export async function loadFacilitySetupFacts(client: SupabaseClient, facilityId: string, read: SetupReader = directRead): Promise<FacilitySetupFacts> {
  const [menus, staff, photos, profile] = await Promise.all([
    read('menus', client.from('facility_menus').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).or('is_published.is.null,is_published.eq.true')),
    read('staff', client.from('staff_profiles').select('id').eq('facility_id', facilityId).eq('is_active', true)),
    read('photos', client.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId)),
    read('facility', client.from('facility_profiles').select('name, prefecture, city, address, business_hours, status').eq('id', facilityId).single()),
  ]);
  const failure = menus.error ?? staff.error ?? photos.error ?? profile.error;
  if (failure) throw new Error(`店舗セットアップの状況を取得できませんでした: ${failure.message}`);

  const activeStaffIds = ((staff.data ?? []) as { id: string }[]).map(row => row.id);
  const scheduled = await loadScheduledStaffIds(client, activeStaffIds, read);
  const row = (profile.data ?? {}) as {
    name?: string | null; prefecture?: string | null; city?: string | null; address?: string | null;
    business_hours?: unknown; status?: string | null;
  };
  return {
    name: row.name ?? null,
    prefecture: row.prefecture ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    status: row.status ?? null,
    businessHours: row.business_hours ?? null,
    publishedMenuCount: menus.count ?? 0,
    photoCount: photos.count ?? 0,
    activeStaffIds,
    unscheduledStaffIds: activeStaffIds.filter(id => !scheduled.has(id)),
  };
}
