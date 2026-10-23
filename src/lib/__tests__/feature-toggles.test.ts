/**
 * Tests for lib/feature-toggles.ts
 * SHOW_* は「後日 true に戻すだけで復活させる」単一フラグ定数。
 * - SHOW_JOBS: 2026年7月16日 神原さん判断で false（求人の公開導線を非表示）。
 *   2026年10月23日に管理画面の求人・求人応募も同じスイッチに従属させた。
 * - SHOW_PACKAGES / SHOW_SUBSCRIPTIONS: 2026年10月23日 神原さん判断「今はなし」で false。
 */

import {
  SHOW_JOBS, SHOW_PACKAGES, SHOW_SUBSCRIPTIONS, OFFER_STATE,
  ADMIN_FEATURE_ROUTES, MYPAGE_FEATURE_ROUTES,
  isUnofferedAdminHref, hiddenMypageHrefs, offeredPlanLabels, unofferedFeatureNotice,
  type OfferState,
} from '../feature-toggles';

const ALL_ON: OfferState = { jobs: true, packages: true, subscriptions: true };
const ALL_OFF: OfferState = { jobs: false, packages: false, subscriptions: false };

describe('SHOW_JOBS', () => {
  test('boolean 型である', () => {
    expect(typeof SHOW_JOBS).toBe('boolean');
  });

  test('現在は false（求人の公開導線を非表示にする神原さん判断・2026年7月16日）', () => {
    expect(SHOW_JOBS).toBe(false);
  });
});

describe('SHOW_PACKAGES / SHOW_SUBSCRIPTIONS', () => {
  test('現在はどちらも false（回数券・月額プランは「今はなし」・2026年10月23日 神原さん判断）', () => {
    expect(SHOW_PACKAGES).toBe(false);
    expect(SHOW_SUBSCRIPTIONS).toBe(false);
  });

  test('OFFER_STATE は 3 定数の束そのもの（別の値を持たない）', () => {
    expect(OFFER_STATE).toEqual({ jobs: SHOW_JOBS, packages: SHOW_PACKAGES, subscriptions: SHOW_SUBSCRIPTIONS });
  });
});

describe('isUnofferedAdminHref', () => {
  test('現在の状態では、回数券・月額プラン・求人・求人応募の管理画面を「提供していない」と判定する', () => {
    for (const href of ['/admin/packages', '/admin/subscription-plans', '/admin/jobs', '/admin/jobs/applications', '/admin/jobs/new', '/admin/jobs/abc/edit']) {
      expect(isUnofferedAdminHref(href)).toBe(true);
    }
  });

  test('他の管理画面は対象外（前方一致で巻き込まない）', () => {
    for (const href of ['/admin', '/admin/menus', '/admin/coupons', '/admin/packagesX', '/admin/jobsboard', '/admin/subscription-plans-old']) {
      expect(isUnofferedAdminHref(href)).toBe(false);
    }
  });

  test('提供中の機能は対象外（true に戻せば導線が復活する）', () => {
    expect(isUnofferedAdminHref('/admin/packages', ALL_ON)).toBe(false);
    expect(isUnofferedAdminHref('/admin/jobs/applications', ALL_ON)).toBe(false);
    expect(isUnofferedAdminHref('/admin/jobs', { ...ALL_ON, jobs: false })).toBe(true);
    expect(isUnofferedAdminHref('/admin/packages', { ...ALL_ON, jobs: false })).toBe(false);
  });

  test('機能ごとのルート表は 3 機能を網羅している', () => {
    expect(Object.keys(ADMIN_FEATURE_ROUTES).sort()).toEqual(['jobs', 'packages', 'subscriptions']);
  });
});

describe('hiddenMypageHrefs', () => {
  const nothingHeld = { packages: false, subscriptions: false };

  test('提供していない機能で、何も持っていない人にはナビを出さない', () => {
    expect(hiddenMypageHrefs(nothingHeld)).toEqual(['/mypage/packages', '/mypage/subscriptions']);
  });

  test('既に持っている人には出し続ける（提供を止めても持っているものは見える）', () => {
    expect(hiddenMypageHrefs({ packages: true, subscriptions: false })).toEqual(['/mypage/subscriptions']);
    expect(hiddenMypageHrefs({ packages: true, subscriptions: true })).toEqual([]);
  });

  test('提供中なら持っていなくても出す', () => {
    expect(hiddenMypageHrefs(nothingHeld, ALL_ON)).toEqual([]);
    expect(Object.values(MYPAGE_FEATURE_ROUTES)).toEqual(['/mypage/packages', '/mypage/subscriptions']);
  });
});

describe('offeredPlanLabels', () => {
  test('現在は回数券・月額プランを出さない', () => {
    expect(offeredPlanLabels()).toEqual([]);
  });

  test('提供中の機能だけを並べる', () => {
    expect(offeredPlanLabels(ALL_ON)).toEqual(['回数券', '月額プラン']);
    expect(offeredPlanLabels({ ...ALL_OFF, subscriptions: true })).toEqual(['月額プラン']);
  });
});

describe('unofferedFeatureNotice', () => {
  test('現在は回数券・月額プラン・求人掲載を提供していないと明示する', () => {
    expect(unofferedFeatureNotice()).toContain('回数券・月額プラン・求人掲載は現在提供していません');
  });

  test('全て提供中なら何も添えない', () => {
    expect(unofferedFeatureNotice(ALL_ON)).toBe('');
  });

  test('止めている機能だけを挙げる', () => {
    expect(unofferedFeatureNotice({ ...ALL_ON, jobs: false })).toMatch(/^求人掲載は現在提供していません/);
  });
});
