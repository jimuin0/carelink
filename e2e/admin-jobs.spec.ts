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
//
// 🔴 【2026-08-13 実測による訂正】旧版はここに「検証落ち時は POST も navigation も起きない＝
//   副作用ゼロで安全に再試行できる（成功は最大 1 回）」と書いていたが、**これは事実に反する**。
//   遷移が起きない失敗モードでは POST は毎回 201 で成功しており、再試行のたびに求人が作られる
//   （ローカル再現で 32 件積み上がるのを DB で実測）。原因は Next.js 15.5 系の
//   「子→親のクライアント遷移が RSC ペイロード約 29KB 超で無音失敗する」不具合で、
//   フォーム・POST・rhf のいずれとも無関係だった（POST を伴わない「戻る」ボタンでも再発）。
//   16.3.0 で解消済み。再発検出は e2e/admin-large-list-nav.spec.ts が決定的に行う
//   （この spec は求人 1 件しか作らずペイロードが閾値の下に収まるため、単独では検出できない）。
import { test, expect } from '@playwright/test';

// 🔴 このテストの制限時間を明示する（2026年8月8日・CI 実測で発覚）。
//   下の toPass は 45000ms を再試行予算として要求しているが、Playwright の既定テスト timeout は
//   30000ms（playwright.config.ts は timeout を設定していない）。**予算の方が制限時間より長く、
//   設計した再試行は最後まで一度も実行できない。**
//   実測（run 31186576371 / admin-jobs）: Playwright の 3 回のリトライすべてが
//   `Test timeout of 30000ms exceeded` で死んだ。内側の waitForURL が 15000ms なので、
//   1 回目で外れると 2 回目の待ちは 15.5s→30.5s となり必ず 30s の壁で打ち切られる。
//   ＝ intervals [500,1000,2000] は名目上 3 回以上の再試行を意味するのに、実際に取れるのは
//   「1 回 ＋ 途中で切られる 1 回」だけ。**収束するはずの再試行が構造的に収束しない。**
//   予算 = goto/heading(expect 10s) + toPass(45s) + 一覧反映(15s) = 70s。余裕を含めて 90s。
//   成功パスの所要時間は変わらない（待てる上限が伸びるだけ）。
// ⚠️ 既定値(30s)を config 全体で伸ばさないこと。他 spec の「速く落ちる」性質まで鈍らせる。
//   長い予算を要求している当のテストに置くのが正しい。
//   不変条件（toPass の予算 < そのテストの制限時間）は
//   src/lib/__tests__/e2e-timeout-budget.test.ts が全 spec を走査して機械強制する。
test.setTimeout(90_000);

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

    // 成功なら router.push で /admin/jobs へ遷移する。遷移しなければ throw して toPass が再試行する。
    // ⚠️ 再試行が「POST を 1 回だけ成功させる」とは限らない。rhf 未受理なら POST は起きないが、
    //   POST が成功しても遷移だけ失敗する経路が実在した（上記の Next 15.5 の不具合）。その場合
    //   再試行のたびに求人が作られる。ここは冪等ではない前提で読むこと。
    // 他 spec のナビゲーション待ち（15000-20000ms）と揃える。8000ms は CI の低速時に
    // 単一試行内で不足し、toPass の再試行（＝フォーム再送信）を誘発し得るため過小だった。
    await page.waitForURL('**/admin/jobs', { timeout: 15000 });
  }).toPass({ timeout: 45000, intervals: [500, 1000, 2000] });

  // 一覧に作成求人が出る（書き込み永続化＋再読込反映）。
  await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
});
