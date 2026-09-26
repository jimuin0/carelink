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
//   実際に prepare→署名写真→POST /api/salons/commit を通し、型不一致を検出する。
//
// 対象:
//   4つの掲載希望時期を実保存し、詳細ケースでは任意slot4の写真1枚、実認証、
//   選択申込から施設setup・管理画面まで通す。他3ケースは任意写真0枚を確認する。
//   写真の競合・応答喪失は別の実Storage API／component回帰でも検証する。
//   reCAPTCHA は NEXT_PUBLIC_RECAPTCHA_SITE_KEY 未設定
//   （CI/開発の既定）だとクライアントがトークンを取得せず、サーバーも RECAPTCHA_SECRET_KEY
//   未設定なら検証をスキップする（recaptcha-client.ts / route.ts 参照）ため、
//   CI 環境ではreCAPTCHA関連の追加操作は不要。
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// This suite writes synthetic applications. Never run it against a hosted DB/app.
test.beforeAll(() => {
  // The checked-in workflow builds against its disposable DB and starts a new
  // app process (reuseExistingServer:false). An arbitrary localhost dev server
  // could use hosted credentials even when this test process uses local ones.
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    throw new Error('register-submit requires the managed GitHub CI local Supabase/app lifecycle');
  }
  for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000']) {
    if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('register-submit requires an isolated loopback app and Supabase');
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('local DB verification credentials are required');
});

// This suite deliberately intercepts API calls. The app's lazy-loaded PWA
// service worker can otherwise take control during a long mobile form flow and
// bypass Playwright's page-level route handler, allowing a real local POST.
// Service-worker behavior is outside this submission-state test's scope.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

// Every preference is exercised through the real local database, not a mock.
const CASES = [
  { value: 'immediately', label: 'すぐに掲載したい' },
  { value: 'within_1month', label: '1か月以内' },
  { value: 'within_3months', label: '3か月以内' },
  { value: 'undecided', label: '検討中' },
] as const;

async function fillStep1(page: Page, email: string, detailed = false) {
  await expect(page.locator('#reg-facility-name')).toBeEnabled();
  await page.fill('#reg-facility-name', `E2E登録テスト施設 ${Date.now()}`);
  await page.selectOption('#reg-business-type', { label: 'ヘアサロン' });
  await page.fill('#reg-rep-name', '代表 太郎');
  await page.fill('#reg-contact-name', '担当 花子');
  await page.fill('#reg-email', email);
  await page.fill('#reg-phone', detailed ? '０９０１２３４５６７８' : '09012345678');
  if (detailed) {
    await page.locator('details').filter({ has: page.locator('#reg-contact-phone') }).locator('summary').click();
    await page.fill('#reg-contact-phone', '０８０１２３４５６７８');
    await page.fill('#reg-website', 'https://fixture.example.invalid/');
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-postal-code')).toBeVisible();
}

async function fillStep2(page: Page, detailed = false) {
  // 詳細情報は全項目任意。何も入力せず次へ進めることそのものが「フォームが誤って
  // 必須化していない」ことの確認になる。
  if (detailed) {
    // Postal provider is stubbed; the app/API/database registration path is real.
    await page.route('https://zipcloud.ibsnet.co.jp/api/search*', route => route.fulfill({
      json: { status: 200, results: [{ address1: '愛知県', address2: '西尾市', address3: '合成町' }] },
    }));
    await page.fill('#reg-postal-code', '000-0000');
    await expect(page.locator('#reg-address')).toHaveValue('愛知県西尾市合成町');
    await page.locator('details').filter({ has: page.locator('#reg-building-name') }).locator('summary').click();
    await page.fill('#reg-building-name', '合成ビル101');
    await page.fill('#reg-nearest-station', '合成駅 徒歩5分');
    await page.fill('#reg-business-hours', '10:00〜18:00');
    await page.fill('#reg-regular-holiday', '月曜日');
    await page.fill('#reg-seat-count', '0');
    await page.fill('#reg-staff-count', '9999');
    await page.getByRole('checkbox', { name: '駐車場あり' }).check();
    await page.getByRole('button', { name: 'WiFi完備', exact: true }).click();
  }
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-desired-start-date')).toBeVisible();
}

test.describe('/register 送信', () => {
  test('受付番号だけを指定しても他の申込を完了表示しない', async ({ page }) => {
    await page.goto('/register/complete?id=11111111-2222-4333-8444-555555555555');
    await expect(page.getByRole('heading', { name: '受付状況を確認できませんでした' })).toBeVisible();
    await expect(page.getByRole('link', { name: '受付状況を問い合わせる' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '登録が完了しました！' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'アカウントを作成して始める' })).toHaveCount(0);
  });
  test('POST結果不明では完了へ進まず同画面の再送を止める', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/salons/commit', async (route) => {
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
    await expect(page.getByText('送信結果を確認できませんでした。同じ申込の受付状況を確認してください。新たな申込として送信しないでください。')).toBeVisible();
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
    await fillStep1(page, `e2e-register-probe-${Date.now()}@example.invalid`);
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
    test(`「掲載希望時期」で ${label}（${value}）を選んで送信すると /register/complete に着地する`, async ({ page }, testInfo) => {
      // Each save scenario represents a different synthetic client. Do not let
      // two browser projects/retries share the 5 requests/minute local IP bucket.
      // The actual limiter remains enabled; its rejection contract is tested
      // separately by the API tests. These reserved addresses never leave CI.
      const client = 10 + CASES.findIndex(c => c.value === value) * 10
        + testInfo.retry * 2 + (testInfo.project.name === 'chromium' ? 0 : 1);
      await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${client}` });
      await page.goto('/register');

      const detailed = value === 'immediately';
      const email = `e2e-register-${value}-${randomUUID()}@example.invalid`;
      await fillStep1(page, email, detailed);
      await fillStep2(page, detailed);

      // Step 3: 詳細ケースだけメニュー写真1枚、他は任意写真0枚。
      await page.selectOption('#reg-desired-start-date', { value });
      if (detailed) {
        await page.fill('#reg-pr-text', '隔離E2Eの合成紹介文');
        await page.getByLabel('メニュー 1の写真を選択').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZsAAAAASUVORK5CYII=', 'base64') });
        await expect(page.getByRole('img', { name: 'メニュー 1', exact: true })).toBeVisible();
      }

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

      // POST /api/salons/commit のレスポンスを直接観測する。画面遷移だけを見ると、
      // 別の理由（クライアント側の別ルーティング等）で complete に着いた場合を見逃すため、
      // ステータスそのものを主張する（このファイルの主目的＝空振り防止その2）。
      const salonsResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/salons/commit' && r.request().method() === 'POST',
        { timeout: 20000 },
      );
      await page.getByRole('button', { name: '送信する' }).click();
      const resp = await salonsResponse;

      if (resp.status() !== 201) {
        throw new Error(
          `POST /api/salons/commit が ${resp.status()} を返した（desired_start_date=${value}）。\n` +
            `これは docs/register-blocker-instructions.md の実障害（date 型不一致による 500）の\n` +
            '再発の可能性があります。request/responseの実値はログへ出しません。',
        );
      }
      expect(resp.status(), `POST /api/salons/commit が 201 以外（desired_start_date=${value}）`).toBe(201);
      const receipt = await resp.json();
      expect(receipt.state).toBe('committed');
      expect(receipt.receiptId).toMatch(/^[0-9a-f-]{36}$/i);

      await page.waitForURL('**/register/complete**', { timeout: 20000 });
      await expect(page).toHaveURL(/\/register\/complete/);
      await expect(page.getByRole('heading', { name: '掲載申込を受け付けました' })).toBeVisible();
      await expect(page.getByText(receipt.receiptId, { exact: true })).toBeVisible();
      expect(new URL(page.url()).search).toBe('?handoff=registration');
      const claim = (await page.context().cookies()).find(cookie => cookie.name.startsWith('carelink_salon_intent_'));
      // Never include the capability cookie value in assertion output.
      expect({ present: !!claim, secure: claim?.secure, httpOnly: claim?.httpOnly, sameSite: claim?.sameSite })
        .toEqual({ present: true, secure: true, httpOnly: true, sameSite: 'Lax' });
      await expect(page.getByText('この時点では一般公開は完了していません。店舗アカウントを作成し、管理画面で店舗情報・メニュー・スタッフ・写真を確認して公開してください。')).toBeVisible();
      await expect(page.getByRole('link', { name: '店舗アカウントを作成する' })).toHaveAttribute('href',
        '/auth/signup?redirect=%2Fadmin%2Fonboarding%3Fhandoff%3Dregistration');
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: saved, error } = await db.from('salons')
        .select('desired_start_date, phone, contact_phone, website, postal_code, address, prefecture, city, building_name, nearest_station, business_hours, regular_holiday, seat_count, staff_count, has_parking, features, pr_text, source, is_public')
        .eq('id', receipt.receiptId).single();
      expect(error).toBeNull();
      expect(saved).toMatchObject({ desired_start_date: value, source: 'register', is_public: false });
      if (detailed) expect(saved).toMatchObject({
        phone: '09012345678', contact_phone: '08012345678', website: 'https://fixture.example.invalid/',
        postal_code: '0000000', address: '愛知県西尾市合成町', prefecture: '愛知県', city: '西尾市',
        building_name: '合成ビル101', nearest_station: '合成駅 徒歩5分', business_hours: '10:00〜18:00',
        regular_holiday: '月曜日', seat_count: 0, staff_count: 9999, has_parking: true,
        features: ['WiFi完備'], pr_text: '隔離E2Eの合成紹介文',
      });
      if (detailed) {
        // Real UI -> signed Storage -> receipt -> password login -> selected
        // onboarding -> atomic setup. Synthetic confirmed identity, no email.
        const password = randomUUID();
        const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw new Error('Synthetic owner creation failed');
        await page.getByRole('link', { name: '既存アカウントでログインする' }).click();
        await page.fill('#login-email', email);
        await page.fill('#login-password', password);
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();
        await page.waitForURL('**/admin/onboarding?handoff=registration');
        await expect(page.locator('#onboarding-business-type')).toHaveValue('ヘアサロン');
        await expect(page.locator('#onboarding-facility-name')).toHaveValue(/^E2E登録テスト施設 /);
        await page.getByRole('checkbox').check();
        const setupResult = page.waitForResponse(r => new URL(r.url()).pathname === '/api/facility/setup'
          && r.request().method() === 'POST');
        await page.getByRole('button', { name: '施設を作成する', exact: true }).click();
        const setup = await setupResult;
        expect(setup.status()).toBe(201);
        const setupBody = await setup.json();
        expect(setupBody.success).toBe(true);
        await page.waitForURL(url => url.pathname === '/admin');
        const { data: claimed, error: claimError } = await db.from('salons')
          .select('claimed_facility_id,claimed_by_user_id').eq('id', receipt.receiptId).single();
        expect(claimError).toBeNull();
        expect(claimed).toEqual({ claimed_facility_id: setupBody.facilityId, claimed_by_user_id: created.data.user.id });
        const { data: photos, error: photoError } = await db.from('facility_photos')
          .select('photo_type,sort_order,photo_url').eq('facility_id', setupBody.facilityId);
        expect(photoError).toBeNull(); expect(photos).toHaveLength(1);
        expect(photos![0]).toMatchObject({ photo_type: 'menu', sort_order: 0 });
        expect(photos![0].photo_url).toContain('/salon-intents/');
        const { data: profile, error: profileError } = await db.from('facility_profiles')
          .select('status,address,prefecture,city').eq('id', setupBody.facilityId).single();
        expect(profileError).toBeNull();
        expect(profile).toMatchObject({ status: 'draft', address: '愛知県西尾市合成町', prefecture: '愛知県', city: '西尾市' });
      }
    });
  }
});
