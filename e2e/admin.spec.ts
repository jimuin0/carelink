// 管理画面（オーナー）E2E。admin.setup.ts が seed した認証状態（storageState）で
// /admin/* を開き、オーナー機能が実際に動く（描画・実データ反映）ことを検証する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
//
// 【順序の重要性】書き込みテスト（承認・会計）は seed データを変更する（確定→完了で本日売上が
// 増える等）。読み取り検証（ダッシュボード KPI ¥8,000 等）は seed 初期値に依存するため、
// 読み取りを先・書き込みを後に固定する（describe.serial で宣言順を保証）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { SEED, PENDING_BOOKING_FILE, CONFIRMED_BOOKING_FILE } from './admin.fixtures';

test.describe.serial('管理画面（オーナー）', () => {
  // ── 読み取り検証（seed 初期値に依存・書き込みより前に実行）──
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

  // ── 書き込み検証（seed を変更するため最後に実行）──
  // オーナーの予約処理＝承認の書き込みフロー。承認待ち予約を「承認する」→ 確定になり
  // 退店レジ会計（確定/受付のみ表示）が出ることを実データで検証する。
  test('承認待ち予約をオーナーが承認できる（書き込み反映）', async ({ page }) => {
    const { id } = JSON.parse(fs.readFileSync(PENDING_BOOKING_FILE, 'utf8')) as { id: string };
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText(SEED.pendingCustomer)).toBeVisible();
    const approve = page.getByRole('button', { name: '承認する' });
    await expect(approve).toBeVisible();
    await approve.click();
    // 承認後＝確定。承認セクションが消え、確定のみ表示される会計セクションが出る。
    await expect(page.getByRole('button', { name: '承認する' })).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('退店・お会計')).toBeVisible();
  });

  // オーナーの退店レジ会計＝確定予約を会計して完了にする書き込み（副作用＝来店記録/日次売上）。
  test('確定予約を退店レジ会計で完了にできる（書き込み反映）', async ({ page }) => {
    const { id } = JSON.parse(fs.readFileSync(CONFIRMED_BOOKING_FILE, 'utf8')) as { id: string };
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText(SEED.confirmedCustomer)).toBeVisible();
    // 会計する → 明細(確定予約の total_price で1行自動投入) → 会計を確定して完了
    await page.getByRole('button', { name: '会計する' }).click();
    // POST /api/admin/booking-checkout の 2xx を成功シグナルに（確定 click より前に登録）。会計完了は
    // 揮発トーストが唯一証拠だったため、非揮発の API 2xx を主判定に据える。
    const checkoutPost = page.waitForResponse(
      (r) => r.url().includes('/api/admin/booking-checkout') && r.request().method() === 'POST' && r.ok(),
      { timeout: 15000 }
    );
    await page.getByRole('button', { name: '会計を確定して完了' }).click();
    await checkoutPost;
  });

  // オーナーのメニュー作成（CRUD の C）＝メニュー追加→保存→一覧に反映。
  test('オーナーがメニューを追加できる（書き込み→一覧反映）', async ({ page }) => {
    const menuName = 'E2E追加メニュー';
    await page.goto('/admin/menus');
    await page.getByRole('button', { name: 'メニュー追加' }).click();
    // Modal(role=dialog) が開くのを待ち、その中だけを操作する。
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // 必須はメニュー名のみ（handleSave は name.trim() のみ必須）。最小入力で保存する。
    await dialog.locator('#menu-name').fill(menuName);
    // 保存ボタンはキーボード起動（focus→Enter）で確定する。CI の headless/dvh ビューポートでは
    // モーダルフッターが pointer hit-test で被り判定になり .click() がタイムアウトすることがあるため、
    // ポインタ被りに依存しないキーボード操作（正当なユーザー操作）で確実に起動する。
    const saveBtn = dialog.getByRole('button', { name: '保存' });
    await saveBtn.scrollIntoViewIfNeeded();
    // POST /api/admin/menus の 2xx を成功シグナルに（press より前に登録）。揮発トースト依存を外し、
    // 下の一覧反映（永続 DOM）で確定する。
    const menuPost = page.waitForResponse(
      (r) => r.url().includes('/api/admin/menus') && r.request().method() === 'POST' && r.ok(),
      { timeout: 15000 }
    );
    await saveBtn.press('Enter');
    await menuPost;
    // 一覧に追加したメニューが出る（書き込みが永続化され再読込で反映）
    await expect(page.getByText(menuName)).toBeVisible();
  });

  // オーナーのクーポン作成（CRUD の C）＝新規作成→一覧へ反映。
  test('オーナーがクーポンを作成できる（書き込み→一覧反映）', async ({ page }) => {
    const couponName = 'E2E追加クーポン';
    await page.goto('/admin/coupons/new');
    await page.fill('#coupon-name', couponName);
    await page.fill('#coupon-value', '500'); // discount_type=fixed の既定で割引額が必要
    await page.getByRole('button', { name: 'クーポンを作成' }).click();
    // 作成成功で /admin/coupons へ遷移し、一覧に出る（書き込み永続化）
    await page.waitForURL('**/admin/coupons', { timeout: 15000 });
    await expect(page.getByText(couponName)).toBeVisible();
  });

  // オーナーのスタッフ作成（CRUD の C）＝新規作成→一覧反映。
  // POST は nomination_fee / line_works_* 列も書き込むため、本番先行列の catch-up も暗に検証する。
  test('オーナーがスタッフを追加できる（書き込み→一覧反映）', async ({ page }) => {
    const staffNewName = 'E2E追加スタッフ';
    await page.goto('/admin/staff/new');
    await page.fill('#staff-name', staffNewName);
    await page.getByRole('button', { name: 'スタッフを追加' }).click();
    await page.waitForURL('**/admin/staff', { timeout: 15000 });
    await expect(page.getByText(staffNewName)).toBeVisible();
  });
});
