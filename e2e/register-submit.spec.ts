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
//   写真は外観必須の契約どおり、合成画像をローカル Supabase Storage へアップロードする。
//   reCAPTCHA は NEXT_PUBLIC_RECAPTCHA_SITE_KEY 未設定
//   （CI/開発の既定）だとクライアントがトークンを取得せず、サーバーも RECAPTCHA_SECRET_KEY
//   未設定なら検証をスキップする（recaptcha-client.ts / route.ts 参照）ため、
//   CI 環境ではreCAPTCHA関連の追加操作は不要。
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Tiny synthetic image used only against the disposable local Supabase in E2E.
const E2E_EXTERIOR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==',
  'base64',
);

function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { hostname, protocol } = new URL(value);
    return protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

test.beforeEach(async () => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
  test.skip(
    !isLocalUrl(appUrl) || !isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    'Registration E2E runs only against local app and local Supabase',
  );
});

test('DB は新規 register に外観写真がない行を拒否する', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'DB contract は1回だけ確認');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !isLocalUrl(url) || !serviceRoleKey || !anonKey) {
    throw new Error('DB contract test requires the disposable local Supabase credentials');
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const invalidPhotoSets = [
    [],
    ['https://carelink.invalid/storage/v1/object/public/carelink-uploads/salons/e2e/interior_1.jpg'],
  ];
  for (const [index, photo_urls] of invalidPhotoSets.entries()) {
    const now = Date.now();
    const { error } = await supabase.from('salons').insert({
      facility_name: `E2E 制約検証 ${now}`,
      business_type: 'ヘアサロン',
      representative_name: 'E2E代表',
      contact_name: 'E2E担当',
      email: `e2e-photo-constraint-${now}-${index}@example.invalid`,
      phone: '00000000000',
      source: 'register',
      photo_urls,
    });

    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('salons_register_requires_exterior_photo');
  }

  // SECURITY DEFINER RPC は service_role 専用。存在しない一意コードを使うため、
  // 誤って権限が残っていても referral_codes の行は変更されない。
  const probeCode = `__e2e_acl_probe_${crypto.randomUUID()}__`;
  const rpcUrl = `${url}/rest/v1/rpc/increment_referral_code_used_count`;
  const serviceRoleResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_code: probeCode }),
  });
  expect(serviceRoleResponse.ok).toBe(true);
  await expect(serviceRoleResponse.json()).resolves.toBeNull();

  const anonResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_code: probeCode }),
  });
  expect(anonResponse.ok).toBe(false);
  const anonError = await anonResponse.json().catch(() => null);
  expect(anonError?.code).toBe('42501');
});

// 4択のうち、この2つを実際に踏む。immediately が今回の実障害の直接再現（一番最初の選択肢で
// すぐ落ちていた）、undecided は逆側（列挙の末尾）で「配列の一部だけ通る」形の回帰も拾う。
const CASES: Array<{ value: 'immediately' | 'undecided'; label: string }> = [
  { value: 'immediately', label: 'すぐに掲載したい' },
  { value: 'undecided', label: '検討中' },
];

async function fillStep1(page: Page, email: string) {
  await page.fill('#reg-facility-name', `E2E登録テスト施設 ${Date.now()}`);
  await page.selectOption('#reg-business-type', { label: 'ヘアサロン' });
  await page.fill('#reg-rep-name', '代表 太郎');
  await page.fill('#reg-contact-name', '担当 花子');
  await page.fill('#reg-email', email);
  await page.fill('#reg-phone', '09012345678');
  await page.getByRole('button', { name: '次へ' }).click();
}

async function fillStep2(page: Page) {
  // 詳細情報は全項目任意。何も入力せず次へ進めることそのものが「フォームが誤って
  // 必須化していない」ことの確認になる。
  await page.getByRole('button', { name: '次へ' }).click();
}

async function attachExteriorFixture(page: Page) {
  const input = page.locator('input[type="file"]').nth(0);
  if (test.info().project.name === 'Mobile Safari') {
    // WebKit CI intermittently times out in Playwright's native setInputFiles transport
    // for this hidden input. Exercise the same FileList/change path without testing the OS
    // picker protocol, which is outside this registration/API contract test.
    await input.evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const file = new File([bytes], 'e2e-exterior.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const fileInput = element as HTMLInputElement;
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, E2E_EXTERIOR_PNG.toString('base64'));
    return;
  }

  await input.setInputFiles({
    name: 'e2e-exterior.png',
    mimeType: 'image/png',
    buffer: E2E_EXTERIOR_PNG,
  });
}

test.describe('/register 送信', () => {
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

      // Step 3: PR情報。外観写真必須の契約を満たす合成画像を選択する。
      await attachExteriorFixture(page);
      await expect(page.getByRole('img', { name: '外観' })).toBeVisible();
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
        throw new Error(
          `POST /api/salons が ${resp.status()} を返した（desired_start_date=${value}）。\n` +
            '希望時期を含む店舗登録のE2E契約に失敗しました。送信データはログへ出しません。',
        );
      }
      expect(resp.status(), `POST /api/salons が 200 以外（desired_start_date=${value}）`).toBe(200);

      await page.waitForURL('**/register/complete**', { timeout: 20000 });
      await expect(page).toHaveURL(/\/register\/complete/);
    });
  }
});
