// /register（店舗掲載登録）の送信 E2E。
//
// why（背景・docs/register-blocker-instructions.md）:
//   /register の送信は「掲載希望時期」を選ぶと必ず 500 になっていた。
//   salons.desired_start_date は date 型なのに、フォームは 'immediately' 等の
//   列挙文字列をそのまま送っていたため（実測確定・PG16 で INSERT 22007 を再現）。
//   この不具合を見つけたのは実機での目視であり、CI には検知する仕組みが1つも
//   無かった: (1) route.post.test.ts は @supabase/supabase-js を丸ごとモックしており
//   Postgres の型検査が一度も走らない、(2) /register の送信を通す E2E が1本も無い、
//   (3) 分岐ではなく DB の型の問題なので branches カバレッジ100%でも捕まらない。
//   本ファイルは (2) の穴を埋める。実 DB（CI のローカル Supabase・fresh-apply）に対して
//   実際に POST /api/salons を発火させ、型不一致が再発すれば必ず落ちる。
//
// 対象外（意図）:
//   写真アップロードは検証しない。「外観 *」は表示上の必須マークだけで送信前チェックが
//   どこにも無い（RegisterForm.tsx の photoSlots に required はあるが onSubmit は見ていない）
//   ため、写真0枚のまま送信できる。reCAPTCHA は NEXT_PUBLIC_RECAPTCHA_SITE_KEY 未設定
//   （CI/開発の既定）だとクライアントがトークンを取得せず、サーバーも RECAPTCHA_SECRET_KEY
//   未設定なら検証をスキップする（recaptcha-client.ts / route.ts 参照）ため、
//   CI 環境ではreCAPTCHA関連の追加操作は不要。
import { test, expect, type Page } from '@playwright/test';

// This suite deliberately intercepts API calls. The app's lazy-loaded PWA
// service worker can otherwise take control during a long mobile form flow and
// bypass Playwright's page-level route handler, allowing a real local POST.
// Service-worker behavior is outside this submission-state test's scope.
test.use({ serviceWorkers: 'block' });

// 4択のうち、この2つを実際に踏む。immediately が今回の実障害の直接再現（一番最初の選択肢で
// すぐ落ちていた）、undecided は逆側（列挙の末尾）で「配列の一部だけ通る」形の回帰も拾う。
const CASES: Array<{ value: 'immediately' | 'undecided'; label: string }> = [
  { value: 'immediately', label: 'すぐに掲載したい' },
  { value: 'undecided', label: '検討中' },
];

async function fillStep1(page: Page, email: string) {
  await expect(page.locator('#reg-facility-name')).toBeEnabled();
  await page.fill('#reg-facility-name', `E2E登録テスト施設 ${Date.now()}`);
  await page.selectOption('#reg-business-type', { label: 'ヘアサロン' });
  await page.fill('#reg-rep-name', '代表 太郎');
  await page.fill('#reg-contact-name', '担当 花子');
  await page.fill('#reg-email', email);
  await page.fill('#reg-phone', '09012345678');
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-postal-code')).toBeVisible();
}

async function fillStep2(page: Page) {
  // 詳細情報は全項目任意。何も入力せず次へ進めることそのものが「フォームが誤って
  // 必須化していない」ことの確認になる。
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-desired-start-date')).toBeVisible();
}

test.describe('/register 送信', () => {
  test('POST結果不明では完了へ進まず同画面の再送を止める', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/salons**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      // A 503 models a response whose server-side outcome cannot be trusted, and
      // behaves consistently in Chromium and WebKit. Browser-level aborts can
      // be handled differently by WebKit's navigation/network stack.
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary failure' }),
      });
    });
    await page.goto('/register');
    await fillStep1(page, 'reconciliation-fixture@example.invalid');
    await fillStep2(page);
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    const confirmButton = page.getByRole('dialog').getByRole('button', { name: '送信する', exact: true });
    // WebKit's iPhone emulation can stall a coordinate click on the modal's
    // lower action after body scroll-lock; use the native touch action there.
    if ((page.viewportSize()?.width ?? 0) < 500) await confirmButton.tap();
    else await confirmButton.click();
    await expect(page.getByText('送信結果を確認できませんでした')).toBeVisible();
    await expect(page.getByRole('button', { name: '登録する', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: '受付状況を問い合わせる' })).toHaveAttribute('href', '/contact');
    expect(attempts).toBe(1);
    expect(new URL(page.url()).pathname).toBe('/register');
  });

  test('JS読み込み前は入力を保護し、準備完了後の最初の入力でStep3まで進める', async ({ page }) => {
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
    await page.route('**/_next/static/**/*.js', async (route) => {
      await scriptsReady;
      await route.continue();
    });
    try {
      // load待ちではJS遅延の観測前に詰まるため、document応答後にSSR DOMを観測する。
      await page.goto('/register', { waitUntil: 'commit' });
      await expect(page.locator('#reg-facility-name')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'ページを再読み込み' })).toBeVisible();
      releaseScripts();
      await fillStep1(page, 'hydration-fixture@example.invalid');
      await fillStep2(page);
      await expect(page.locator('#reg-desired-start-date')).toBeVisible();
    } finally {
      releaseScripts();
    }
  });

  test('掲載希望時期の select が実在し、選択肢が4つ以上ある（空振り防止）', async ({ page }) => {
    await page.goto('/register');
    await fillStep1(page, `e2e-register-probe-${Date.now()}@example.com`);
    await fillStep2(page);

    const select = page.locator('#reg-desired-start-date');
    await expect(select, '「掲載希望時期」の select が描画されていない＝この検査は無効').toBeVisible();

    const optionCount = await select.locator('option').count();
    // 空欄プレースホルダ + 4択 = 5。将来 select が空になったり選択肢が減ったりしたら
    // ここで落ちる（本体の主張が「素通り」で緑になることを防ぐ）。
    expect(optionCount, `選択肢が想定より少ない（${optionCount}）`).toBeGreaterThanOrEqual(5);

    // 値そのもの（src/lib/constants.ts の DESIRED_START_DATES）で存在確認する。
    // ラベル文言のリニューアルでは落ちず、選択肢自体が消えたときにだけ落ちる。
    for (const value of ['immediately', 'within_1month', 'within_3months', 'undecided']) {
      await expect(
        select.locator(`option[value="${value}"]`),
        `option[value="${value}"] が見つからない`,
      ).toHaveCount(1);
    }
  });

  for (const { value, label } of CASES) {
    test(`「掲載希望時期」で ${label}（${value}）を選んで送信すると /register/complete に着地する`, async ({ page }) => {
      await page.goto('/register');

      await fillStep1(page, `e2e-register-${value}-${Date.now()}@example.com`);
      await fillStep2(page);

      // Step 3: PR情報。写真は選ばない（外観 * は表示上の必須マークだけで送信前チェックは無い）。
      await page.selectOption('#reg-desired-start-date', { value });

      // 許認可の表明と利用規約同意（両方 disabled ガードの対象・チェックしないと送信不可）。
      // ラベルの文言でスコープする（並び順が変わっても踏み違えないため）。
      await page
        .locator('label', { hasText: '施術は必要な資格を有する者が提供する' })
        .locator('input[type="checkbox"]')
        .check();
      await page
        .locator('label', { hasText: '利用規約' })
        .locator('input[type="checkbox"]')
        .check();

      const submitButton = page.getByRole('button', { name: '登録する' });
      await expect(submitButton).toBeEnabled();

      // 確認ダイアログを経由するフローなので、まず送信ボタン→確認ダイアログの「送信する」の順。
      await submitButton.click();
      await expect(page.getByRole('heading', { name: '登録内容を送信しますか？' })).toBeVisible();

      // POST /api/salons のレスポンスを直接観測する。画面遷移だけを見ると、
      // 別の理由（クライアント側の別ルーティング等）で complete に着いた場合を見逃すため、
      // ステータスそのものを主張する（このファイルの主目的＝空振り防止その2）。
      const salonsResponse = page.waitForResponse(
        (r) => r.url().includes('/api/salons') && r.request().method() === 'POST',
        { timeout: 20000 },
      );
      await page.getByRole('button', { name: '送信する' }).click();
      const resp = await salonsResponse;

      if (resp.status() !== 200) {
        const body = await resp.text().catch(() => '(body 読取不可)');
        const reqBody = resp.request().postData() ?? '(リクエストボディなし)';
        throw new Error(
          `POST /api/salons が ${resp.status()} を返した（desired_start_date=${value}）。\n` +
            `これは docs/register-blocker-instructions.md の実障害（date 型不一致による 500）の\n` +
            `再発の可能性が高い。\nresponse: ${body.slice(0, 500)}\nrequest: ${reqBody.slice(0, 500)}`,
        );
      }
      expect(resp.status(), `POST /api/salons が 200 以外（desired_start_date=${value}）`).toBe(200);

      await page.waitForURL('**/register/complete**', { timeout: 20000 });
      await expect(page).toHaveURL(/\/register\/complete/);
    });
  }
});
