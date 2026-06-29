// オーナー（店舗管理者）が予約をキャンセル／無断キャンセル（status 変更・副作用）できることを
// 実行証明する。CI の隔離 Supabase 上でのみ動作（本番不可侵）。
//
// 各テストは setup が seed した別々の予約を操作するため互いに干渉しない（describe.serial は
// admin.spec と同じく宣言順を固定して CI の再現性を上げる目的）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  OWNER_PENDING_FILE, OWNER_CONFIRMED_FILE, OWNER_NOSHOW_FILE, OWNER_SEED,
} from './owner-cancel.fixtures';

function readId(file: string): string {
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string }).id;
}

test.describe.serial('管理画面（オーナー）キャンセル／無断キャンセル', () => {
  // 修正の回帰：ステータス変更ボタンは「現在状態から実際に遷移可能なステータス」だけを出す
  // （UI/API 共有の SSOT＝ALLOWED_STATUS_TRANSITIONS）。到達不可で押すと必ず 400 になる死にボタン
  // ＝ cancel_fee_paid（webhook 専用の金銭由来状態）と pending（どの状態からも遷移先に無い）は出ない。
  // 確定(confirmed)予約では遷移可能＝受付/完了/キャンセル/無断キャンセルのみ表示される。
  test('到達不可ステータス（cancel_fee_paid・pending・現在状態）はボタンに出ない（死にボタン構造排除の回帰）', async ({ page }) => {
    const id = readId(OWNER_CONFIRMED_FILE);
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText('ステータス変更')).toBeVisible();
    // 確定予約から遷移可能な正規ステータスは出る。
    await expect(page.getByRole('button', { name: 'キャンセル', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '無断キャンセル', exact: true })).toBeVisible();
    // 到達不可な死にボタンは出ない。
    await expect(page.getByRole('button', { name: 'キャンセル料支払済', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '確認待ち', exact: true })).toHaveCount(0);
    // 現在状態（確定）自身も遷移先ではないのでボタンには出ない。
    await expect(page.getByRole('button', { name: '確定', exact: true })).toHaveCount(0);
  });

  // 承認待ち予約をオーナーが「お断りする」→ cancelled（書き込み反映）。
  test('承認待ち予約をオーナーがお断り（キャンセル）できる', async ({ page }) => {
    const id = readId(OWNER_PENDING_FILE);
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText(OWNER_SEED.pendingCustomer)).toBeVisible();
    await page.getByRole('button', { name: 'お断りする', exact: true }).click();
    // 成功トースト（status 変更＝cancelled の通知）。書き込みが反映され承認セクションも消える。
    await expect(page.getByText('ステータスを「キャンセル」に変更し', { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'お断りする', exact: true })).toHaveCount(0);
  });

  // 確定予約をオーナーがキャンセルにする（confirmed → cancelled・書き込み反映）。
  test('確定予約をオーナーがキャンセルにできる', async ({ page }) => {
    const id = readId(OWNER_CONFIRMED_FILE);
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText(OWNER_SEED.confirmedCustomer)).toBeVisible();
    const cancelBtn = page.getByRole('button', { name: 'キャンセル', exact: true });
    await cancelBtn.scrollIntoViewIfNeeded();
    await cancelBtn.click();
    await expect(page.getByText('ステータスを「キャンセル」に変更し', { exact: false })).toBeVisible({ timeout: 15000 });
  });

  // 確定予約をオーナーが無断キャンセルにする（confirmed → no_show・書き込み反映）。
  test('確定予約をオーナーが無断キャンセルにできる', async ({ page }) => {
    const id = readId(OWNER_NOSHOW_FILE);
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByText(OWNER_SEED.noShowCustomer)).toBeVisible();
    const noShowBtn = page.getByRole('button', { name: '無断キャンセル', exact: true });
    await noShowBtn.scrollIntoViewIfNeeded();
    await noShowBtn.click();
    await expect(page.getByText('ステータスを「無断キャンセル」に変更し', { exact: false })).toBeVisible({ timeout: 15000 });
  });
});
