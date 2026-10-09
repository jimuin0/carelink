import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
const localAuthOrigins = ['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost:54330'];
let appOrigin: string;
let authOrigin: string;
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

async function fillSignup(page: Page, email: string) {
  // The SSR fieldset is disabled until React handlers are installed. Native
  // editability is the readiness condition; no fixed sleep or mutation retry.
  await expect(page.locator('#signup-name')).toBeEditable();
  await page.fill('#signup-name', 'E2E登録太郎');
  await page.fill('#signup-email', email);
  await page.fill('#signup-phone', '09012345678');
  await page.selectOption('#signup-prefecture', { label: '東京都' });
  await page.fill('#signup-password', 'password123');
  await page.fill('#signup-password-confirm', 'password123');
}

test.describe('認証フロー', () => {
  // These checks may create only synthetic identities in the disposable local
  // CI Auth service. Refuse a hosted app/provider before opening the browser.
  test.beforeAll(async ({ request, baseURL }) => {
    if (!baseURL || !loopbackHosts.includes(new URL(baseURL).hostname)) {
      throw new Error('Auth E2E requires an isolated loopback app');
    }
    appOrigin = new URL(baseURL).origin;
    const response = await request.get('/auth/signup', { maxRedirects: 0 });
    if (response.status() !== 200 || new URL(response.url()).origin !== appOrigin) {
      throw new Error('Auth E2E requires the signup document on the isolated app origin');
    }
    const connect = (response.headers()['content-security-policy'] || '').split(';')
      .find(value => value.trim().startsWith('connect-src')) || '';
    const verifiedOrigin = connect.trim().split(/\s+/).find(value => localAuthOrigins.includes(value));
    if (!verifiedOrigin) {
      throw new Error('Auth E2E requires the local Supabase API in the app CSP');
    }
    authOrigin = verifiedOrigin;
    const nativeCI = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
    if (!nativeCI && !/^unix:\/\/.+\/\.docker\/run\/docker\.sock$/.test(process.env.DOCKER_HOST || '')) {
      throw new Error('Auth E2E requires the dedicated local Docker runtime');
    }
    const stack = spawnSync('docker', ['ps', '--filter', 'label=com.docker.compose.project=carelink', '--format', '{{.Names}}'],
      { encoding: 'utf8' });
    const names = stack.stdout.trim().split('\n');
    if (stack.status !== 0 || names.filter(name => name === 'supabase_db_carelink').length !== 1
      || names.filter(name => name === 'supabase_kong_carelink').length !== 1) {
      throw new Error('Auth E2E requires the disposable carelink Auth/database stack');
    }
    const database = spawnSync('docker', ['exec', 'supabase_db_carelink', 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres', '-c', "SELECT current_database()='postgres' AND current_setting('server_version_num')::int/10000=17"],
    { encoding: 'utf8' });
    if (database.status !== 0 || database.stdout.trim() !== 't') {
      throw new Error('Auth E2E requires the disposable PG17 database');
    }
  });
  test.beforeEach(async ({ context }) => {
    await context.route('**/*', route => [appOrigin, authOrigin].includes(new URL(route.request().url()).origin)
      ? route.continue() : route.abort());
  });

  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/auth/login');
    // ページ固有の見出し(h1)を role+名前で限定する。`h1, h2` だと共通フッターの
    // 見出しにも一致して曖昧（複数一致/フッター要素）になり誤判定するため。
    await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  });

  test('新規登録ページが表示される', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  });

  test('空のフォーム送信でバリデーションエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const submitBtn = page.getByRole('button', { name: 'ログイン', exact: true });
    await submitBtn.click();
    // フォームは noValidate + zod 検証のため HTML5 validity は常に valid になる。
    // 空送信時に react-hook-form が role="alert" のエラーを表示することを検証する（真の検証経路）。
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('無効なメールアドレスでエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const emailInput = page.getByLabel(/メール|Email/).or(page.locator('input[type="email"]')).first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('invalid-email');
      const submitBtn = page.getByRole('button', { name: 'ログイン', exact: true });
      await submitBtn.click();
      // エラー表示 or HTML5 validation
      const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(validity).toBe(false);
    }
  });

  for (const kind of ['signup', 'login'] as const) {
    test(`${kind}のJS準備前は入力を停止し、準備後の入力を保持する`, async ({ page }) => {
      let releaseScripts: () => void = () => {};
      const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
      let authRequests = 0;
      await page.route('**/auth/v1/**', async route => { authRequests += 1; await route.abort(); });
      await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async route => {
        await scriptsReady;
        await route.fallback();
      });
      try {
        await page.goto(`/auth/${kind}`, { waitUntil: 'domcontentloaded' });
        const input = page.locator(kind === 'signup' ? '#signup-name' : '#login-email');
        await expect(input).toBeDisabled();
        await expect(page.getByRole('button', { name: kind === 'signup' ? 'Googleで登録' : 'Googleでログイン', exact: true })).toBeDisabled();
        releaseScripts();
        await expect(input).toBeEditable();
        const value = kind === 'signup' ? '準備後の合成氏名' : 'after-hydration@example.invalid';
        await input.fill(value);
        await page.getByRole('button', { name: 'パスワードを表示', exact: true }).click();
        await expect(page.getByRole('button', { name: 'パスワードを隠す', exact: true })).toBeVisible();
        await expect(input).toHaveValue(value);
        expect(authRequests).toBe(0);
      } finally {
        releaseScripts();
      }
    });
  }

  test('未同意ではメール登録・Google登録を開始せず、入力を保持する', async ({ page }) => {
    let authRequests = 0;
    // A regression must fail the assertion without creating an account or
    // starting OAuth. Every Auth HTTP request is intercepted, including GET.
    await page.route('**/auth/v1/**', async route => {
      authRequests += 1;
      await route.abort();
    });
    await page.goto('/auth/signup');
    const email = `e2e-unchecked-${randomUUID()}@example.invalid`;
    await fillSignup(page, email);
    const consent = page.getByRole('checkbox', { name: '利用規約およびプライバシーポリシーに同意する（必須）' });
    await expect(consent).not.toBeChecked();
    await page.getByRole('button', { name: '新規登録', exact: true }).click();
    await expect(page.locator('#signup-terms-error')).toHaveText('利用規約とプライバシーポリシーへの同意が必要です');
    await page.getByRole('button', { name: 'Googleで登録', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Googleで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。' })).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/signup$/);
    await expect(page.locator('#signup-name')).toHaveValue('E2E登録太郎');
    await expect(page.locator('#signup-email')).toHaveValue(email);
    await expect(page.locator('#signup-password')).toHaveValue('password123');
    await expect(consent).not.toBeChecked();
    expect(authRequests).toBe(0);
  });

  // docs/register-blocker-instructions.md §3 P0-5 の回帰 E2E。
  // signup/page.tsx:65 が supabase.auth.signUp() の data を破棄しており、成功時に
  // setToast のみで router.push が無かったため、メール確認が無効な設定（CI のローカル
  // Supabase は supabase/config.toml:205 で enable_confirmations = false）だと
  // セッションは張られているのに画面が「確認メールを送信しました」のまま静止していた。
  // ここは jsdom のユニットテスト（signUp をモック）では「本当に画面遷移するか」までは
  // 保証できないため、実 Supabase に対して実際に送信し着地することを見る。
  test('新規登録に成功すると /mypage へ遷移する（signUp後に画面が止まらない）', async ({ page }) => {
    await page.goto('/auth/signup');

    const uniqueEmail = `e2e-signup-${randomUUID()}@example.invalid`;
    await fillSignup(page, uniqueEmail);
    await page.getByRole('checkbox', { name: '利用規約およびプライバシーポリシーに同意する（必須）' }).check();

    const [registered] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).origin === authOrigin && new URL(response.url()).pathname === '/auth/v1/signup'),
      page.getByRole('button', { name: '新規登録' }).click(),
    ]);
    expect(registered.status()).toBe(200);
    expect(registered.request().postDataJSON()).toMatchObject({ email: uniqueEmail,
      data: { display_name: 'E2E登録太郎', phone: '09012345678', prefecture: '東京都' } });

    // 修正前は redirect が発生せず /auth/signup に留まったまま（画面が「押しても反応しない」
    // ように見える不具合そのもの）。redirect 未指定時の既定値は safe-redirect.ts の
    // DEFAULT_REDIRECT（/mypage）。
    await page.waitForURL('**/mypage**', { timeout: 20000 });
    await expect(page).toHaveURL(/\/mypage/);
    await expect(page.getByRole('heading', { name: 'E2E登録太郎さん、こんにちは', exact: true })).toBeVisible();
  });
});
