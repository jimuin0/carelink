// オーナーが求人を作成できることを実行証明する（作成→一覧反映）。
// CI の隔離 Supabase（supabase start）上でのみ動作（本番不可侵）。admin-batch.setup の
// storageState（owner 認証）を使う。POST /api/admin/jobs は単一施設 owner の場合 facilityIds[0]
// を投稿先に解決するため、body に facility_id を含めなくても owner 単独で完走する。
//
// 【hydration レース対策（このフォームは react-hook-form の uncontrolled register）】
// rhf は submit 時に「live DOM の値」ではなく「内部 state（onChange リスナで更新）」を zod 検証する。
// page.fill は DOM 値を即セットし input イベントを 1 回発火するが、その発火が hydration（rhf の
// onChange アタッチ）より前だと内部 state は '' のまま残る。このとき DOM 値は入るので toHaveValue は
// 通る（＝定着確認の偽陽性）が、submit 時の検証は空で落ち POST されない（実ユーザーは hydration 後に
// 入力するため非発症＝製品バグではなくテスト基盤のレース）。
// よって「値が DOM に入ったか」ではなく「フォームが実際に値を受理して送信・遷移したか」という
// 唯一の真実（navigation）を成功条件にし、受理されるまで fill→submit を決定的に再試行する。
// 検証落ち時は POST も navigation も起きない＝副作用ゼロで安全に再試行できる（成功は最大 1 回）。
import { test, expect } from '@playwright/test';

test('オーナーが求人を作成できる（書き込み→一覧反映）', async ({ page }) => {
  const title = `E2E求人_${Date.now()}`;
  await page.goto('/admin/jobs/new');
  await expect(page.getByRole('heading', { name: '求人新規作成' })).toBeVisible();

  const titleInput = page.locator('#job-title');
  const jobTypeInput = page.locator('#job-type');
  // 送信ボタンは type=submit。focus→Enter でフォーム送信（CI headless の pointer hit-test 被り回避）。
  const submitBtn = page.getByRole('button', { name: '求人を作成' });

  // 必須はタイトル・職種（雇用形態は既定「正社員」・給与は任意で空→null）。最小入力で作成する。
  // fill→submit→「/admin/jobs への遷移」を一体で再試行する。hydration 完了後は input イベントが
  // rhf の onChange に届き内部 state が更新されるため、遷移が起きて再試行は収束する。
  await expect(async () => {
    // 毎回クリアしてから入力し直す（hydration 後の fill が確実に input イベントを再発火させる）。
    await titleInput.fill('');
    await titleInput.fill(title);
    await jobTypeInput.fill('');
    await jobTypeInput.fill('美容師');
    // blur で onChange/onBlur を確定させ、次フィールドへフォーカスを移す。
    await jobTypeInput.blur();
    // DOM 値は入っていること（最低限の前提確認。これだけでは rhf 受理は保証されない＝下の遷移で断定）。
    await expect(titleInput).toHaveValue(title);
    await expect(jobTypeInput).toHaveValue('美容師');

    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.press('Enter');

    // 成功なら router.push で /admin/jobs へ遷移する。遷移しなければ（検証落ち＝rhf 未受理）throw して
    // toPass が再試行する。遷移したら成功＝ループを抜ける（成功 POST は 1 回のみ）。
    // 他 spec のナビゲーション待ち（15000-20000ms）と揃える。8000ms は CI の低速時に
    // 単一試行内で不足し、toPass の再試行（＝フォーム再送信）を誘発し得るため過小だった。
    await page.waitForURL('**/admin/jobs', { timeout: 15000 });
  }).toPass({ timeout: 45000, intervals: [500, 1000, 2000] });

  // 一覧に作成求人が出る（書き込み永続化＋再読込反映）。
  await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
});
