// 管理画面（オーナー）E2E。admin.setup.ts が seed した認証状態（storageState）で
// /admin/* を開き、オーナー機能が実際に動く（描画・実データ反映）ことを検証する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import { SEED } from './admin.fixtures';

test.describe('管理画面（オーナー）', () => {
  test('ダッシュボードが実データの経営KPIを表示する', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();

    // #293 KPI：本日の売上＝完了予約の total_price（¥8,000）
    await expect(page.getByText(SEED.expectedTodayRevenue).first()).toBeVisible();
    // #293 KPI：無断キャンセル率＝no_show/(completed+no_show)=50%
    await expect(page.getByText(SEED.expectedNoShowRate).first()).toBeVisible();
    // #294 警告：公開中だがスケジュール未設定で予約不能
    await expect(page.getByText('予約を受け付けられません')).toBeVisible();
    // 最近の予約に seed した完了予約が出る（読み取り経路の実証）
    await expect(page.getByText(SEED.completedCustomer)).toBeVisible();
  });

  test('スタッフ一覧に登録済みスタッフが表示される', async ({ page }) => {
    await page.goto('/admin/staff');
    await expect(page.getByText(SEED.staffName)).toBeVisible();
    expect(page.url()).toContain('/admin/staff');
  });

  test('売上分析ページが表示される', async ({ page }) => {
    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { name: '売上分析' })).toBeVisible();
    expect(page.url()).toContain('/admin/analytics');
  });

  test('予約一覧に seed した予約が表示される', async ({ page }) => {
    await page.goto('/admin/bookings');
    expect(page.url()).toContain('/admin/bookings');
    await expect(page.getByText(SEED.completedCustomer).first()).toBeVisible();
  });

  // 主要なオーナー向け管理画面が「認証状態で表示される（ログインへ飛ばされない）」スモーク。
  const SMOKE_ROUTES = [
    '/admin/menus',
    '/admin/customers',
    '/admin/settings',
    '/admin/schedule',
    '/admin/coupons',
    '/admin/photos',
    '/admin/funnel',
    '/admin/accounting',
    '/admin/reviews',
    '/admin/qa',
  ];

  for (const route of SMOKE_ROUTES) {
    test(`${route} が認証状態で表示される`, async ({ page }) => {
      const res = await page.goto(route);
      // 5xx でない（サーバーエラーで落ちない）
      expect(res?.status() ?? 200).toBeLessThan(500);
      // 未認証リダイレクト（/auth/login）に飛ばされていない＝認可が通っている
      expect(page.url()).toContain(route);
      // Next のエラーバウンダリ文言が出ていない
      await expect(page.getByText('Application error')).toHaveCount(0);
    });
  }
});
