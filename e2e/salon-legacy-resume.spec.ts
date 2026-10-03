import { test, expect, type Page, type Route, type Response } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// Actual patched consumer frozen in V1 mode, against the real post-cutover
// isolated server/Storage. This is not proof that already shipped old JS upgrades.
// No global policy changes, production credentials, notifications or screenshots.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(() => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.SALON_REGISTRATION_V2_ENABLED !== 'true'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
    throw new Error('Legacy resume browser proof requires managed disposable CI without sending credentials');
  }
});
const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function pictures() {
  return Promise.all([0, 1].map(async index => ({ name: `synthetic-original-${index}.png`, mimeType: 'image/png',
    buffer: await sharp({ create: { width: 16, height: 16, channels: 4,
      background: index === 0 ? { r: 210, g: 12, b: 35, alpha: 0.4 } : { r: 18, g: 100, b: 210, alpha: 1 } } }).png().toBuffer(),
  })));
}
async function privacy(page: Page) {
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await expect(page.getByRole('button', { name: '必須のみ', exact: true })).toBeHidden();
}
async function populate(page: Page, email: string, name: string, files: Awaited<ReturnType<typeof pictures>>) {
  await expect(page.locator('#reg-facility-name')).toBeEnabled();
  await page.locator('#reg-facility-name').fill(name);
  await page.locator('#reg-business-type').selectOption('ヘアサロン');
  await page.locator('#reg-rep-name').fill('合成代表');
  await page.locator('#reg-contact-name').fill('合成担当');
  await page.locator('#reg-email').fill(email);
  await page.locator('#reg-phone').fill('09000000000');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.locator('#reg-address').fill('愛知県西尾市合成町1');
  await page.locator('#reg-business-hours').fill('10:00〜19:00');
  await page.locator('#reg-seat-count').fill('0');
  await page.locator('#reg-staff-count').fill('2');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.locator('#reg-pr-text').fill('合成入力の復元と写真の順序を検証');
  await page.getByLabel('外観の写真を選択', { exact: true }).setInputFiles(files[0]);
  await page.getByLabel('内観 1の写真を選択', { exact: true }).setInputFiles(files[1]);
  await assertOriginalPreviews(page, files);
}
async function assertOriginalPreviews(page: Page, files: Awaited<ReturnType<typeof pictures>>) {
  for (const [index, label] of ['外観', '内観 1'].entries()) {
    const preview = page.getByRole('img', { name: label, exact: true });
    await expect(preview).toHaveAttribute('src', `data:image/png;base64,${files[index].buffer.toString('base64')}`);
  }
}
async function consentAndSubmit(page: Page) {
  await page.getByRole('checkbox', { name: /当施設の運営に法令上必要な許可/ }).check();
  await page.getByRole('checkbox', { name: /利用規約.*プライバシーポリシー/ }).check();
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '送信する', exact: true }).click();
}
async function isolateServerRateLimit(page: Page, ip: string) {
  // Synthetic rate-limit identity belongs only to the application API. Never
  // add it to cross-origin Auth/Storage requests or their CORS preflights.
  await page.route('https://localhost:3000/api/salons/**', route => route.continue({
    headers: { ...route.request().headers(), 'x-real-ip': ip },
  }));
}
async function frozenV1(page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & { __next_f?: unknown[]; __carelinkV1PropFreezes?: number };
    const queue = target.__next_f || [];
    let downstream: (...values: unknown[]) => unknown = Array.prototype.push;
    target.__carelinkV1PropFreezes = 0;
    Object.defineProperty(queue, 'push', {
      configurable: true,
      get: () => (...entries: unknown[]) => {
        const frozen = entries.map(entry => {
          if (!Array.isArray(entry) || typeof entry[1] !== 'string') return entry;
          const marker = '"v2Enabled":true';
          const count = entry[1].split(marker).length - 1;
          target.__carelinkV1PropFreezes! += count;
          return count ? [entry[0], entry[1].replaceAll(marker, '"v2Enabled":false'), ...entry.slice(2)] : entry;
        });
        return downstream.apply(queue, frozen);
      },
      set: (handler: (...values: unknown[]) => unknown) => { downstream = handler; },
    });
    target.__next_f = queue;
  });
  // Keep the real HTTP response/origin, TLS, CSP and browser address space.
  // Only the real bootstrap's parsed configuration prop is frozen before React.
  const document = await page.goto('/register');
  expect(document?.status()).toBe(200);
  expect(await page.evaluate(() => (window as typeof window & { __carelinkV1PropFreezes?: number }).__carelinkV1PropFreezes)).toBe(1);
  await privacy(page);
}
function legacyStorageResponse(page: Page): Promise<Response> {
  const legacy = (url: string) => /\/storage\/v1\/object\/carelink-uploads\/salons\//.test(new URL(url).pathname);
  let detach = () => {};
  const failed = new Promise<never>((_, reject) => {
    const observe = (request: import('@playwright/test').Request) => {
      if (request.method() !== 'POST' || !legacy(request.url())) return;
      // Classify only; never log URLs, paths containing capabilities or headers.
      const text = request.failure()?.errorText || '';
      const category = /(?:net::)?ERR_[A-Z_]+/.exec(text)?.[0]
        || (text === 'Load failed' ? 'browser_load_failed' : 'browser_transport_failure');
      reject(new Error(`Legacy Storage transport failed (${category}); no policy rejection response observed`));
    };
    page.on('requestfailed', observe);
    detach = () => page.off('requestfailed', observe);
  });
  const response = page.waitForResponse(result => result.request().method() === 'POST' && legacy(result.url()));
  const result = Promise.race([response, failed]).finally(() => detach());
  // Submission UI actions are awaited before this observer; retain the original
  // rejection for its later await without an interim unhandled-rejection report.
  void result.catch(() => {});
  return result;
}

test('frozen V1 configuration reaches real denied legacy upload, preserves inputs, then explicit signed retry reconciles photos', async ({ page }, info) => {
  test.setTimeout(90000);
  await isolateServerRateLimit(page, `198.18.${20 + info.retry}.${info.project.name === 'chromium' ? 21 : 22}`);
  const email = `synthetic-legacy-${randomUUID()}@example.invalid`, name = `合成旧フォーム ${randomUUID()}`;
  const files = await pictures();
  await frozenV1(page);
  let legacyPosts = 0, commits = 0, signedFailures = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/salons') legacyPosts++;
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/salons/commit') commits++;
  });
  await populate(page, email, name, files);
  const denied = legacyStorageResponse(page);
  await consentAndSubmit(page);
  const response = await denied;
  const rejection = await response.json();
  expect(response.status() === 403 || String(rejection.statusCode) === '403').toBe(true);
  const recover = page.getByRole('button', { name: '安全なアップロードで再試行', exact: true });
  await expect(recover).toBeVisible();
  expect(legacyPosts).toBe(0); expect(commits).toBe(0);
  await assertOriginalPreviews(page, files);
  await expect(page.locator('#reg-pr-text')).toHaveValue('合成入力の復元と写真の順序を検証');
  const failMint = async (route: Route) => {
    if (signedFailures++ === 0) return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ code: 'PHOTO_UNAVAILABLE' }) });
    return route.fallback();
  };
  await page.route('**/api/salons/photos', failMint);
  const mintFailure = page.waitForResponse(result => new URL(result.url()).pathname === '/api/salons/photos' && result.status() === 503);
  await recover.click(); // Explicit recovery validates and attempts signed submission.
  await mintFailure;
  await expect(page.getByRole('button', { name: '登録する', exact: true })).toBeEnabled();
  expect(commits).toBe(0);
  await assertOriginalPreviews(page, files);
  await page.unroute('**/api/salons/photos', failMint);
  const committed = page.waitForResponse(result => result.request().method() === 'POST'
    && new URL(result.url()).pathname === '/api/salons/commit');
  await consentAndSubmit(page);
  const saved = await committed;
  expect(saved.status()).toBe(201);
  const result = await saved.json();
  await page.waitForURL(url => url.pathname === '/register/complete');
  await expect(page.getByRole('heading', { name: '掲載申込を受け付けました', exact: true })).toBeVisible();
  await expect(page.getByText(`受付番号：${result.receiptId}`, { exact: true })).toBeVisible();
  expect(legacyPosts).toBe(0); expect(commits).toBe(1);
  const db = service();
  const receipts = await db.from('salons').select('id,facility_name,business_hours,seat_count,staff_count,pr_text,photo_urls').eq('email', email);
  expect(receipts.error).toBeNull(); expect(receipts.data).toHaveLength(1);
  expect(receipts.data![0].id).toBe(result.receiptId);
  expect(receipts.data![0]).toMatchObject({ facility_name: name, business_hours: '10:00〜19:00',
    seat_count: 0, staff_count: 2, pr_text: '合成入力の復元と写真の順序を検証' });
  expect(receipts.data![0].photo_urls).toHaveLength(2);
  // Intent is selected from the actual receipt linkage, not assumed from response shape.
  const intent = await db.from('salon_submission_intents').select('id').eq('salon_id', result.receiptId).single();
  expect(intent.error).toBeNull();
  const photos = await db.from('salon_submission_photos').select('*').eq('intent_id', intent.data!.id).order('slot');
  expect(photos.error).toBeNull(); expect(photos.data).toHaveLength(2);
  expect(photos.data!.map(photo => photo.slot)).toEqual([0, 1]);
  for (const photo of photos.data!) {
    const object = await db.storage.from('carelink-uploads').download(photo.object_path);
    expect(object.error).toBeNull(); expect(object.data).not.toBeNull();
    expect(object.data!.size).toBe(photo.byte_size);
  }
  expect(receipts.data![0].photo_urls).toEqual(photos.data!.map(photo => db.storage.from('carelink-uploads').getPublicUrl(photo.object_path).data.publicUrl));
});

type DraftFile = { name: string; type: string; size: number; lastModified: number; base64: string; sha256: string };
type DraftBackup = { format: string; version: number; payload: { values: Record<string, unknown>; photos: (DraftFile | null)[] }; sha256: string };
async function downloadBackup(page: Page): Promise<DraftBackup> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '入力と元の写真をバックアップ', exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('Synthetic draft download unavailable');
  return JSON.parse(await readFile(path, 'utf8')) as DraftBackup;
}
function assertBackup(backup: DraftBackup, files: Awaited<ReturnType<typeof pictures>>) {
  expect(backup.format).toBe('carelink-local-draft'); expect(backup.version).toBe(1);
  expect(backup.sha256).toBe(digest(Buffer.from(JSON.stringify(backup.payload))));
  expect(backup.payload.photos).toHaveLength(7);
  expect(backup.payload.photos.slice(2)).toEqual([null, null, null, null, null]);
  for (const [slot, file] of files.entries()) {
    const stored = backup.payload.photos[slot]!;
    expect(stored.name).toBe(file.name); expect(stored.type).toBe(file.mimeType);
    expect(stored.size).toBe(file.buffer.length); expect(stored.sha256).toBe(digest(file.buffer));
    expect(Buffer.from(stored.base64, 'base64').equals(file.buffer)).toBe(true);
  }
  // The portable file must contain data only, never a submission capability.
  expect(Object.keys(backup).sort()).toEqual(['format', 'payload', 'sha256', 'version']);
  expect(Object.keys(backup.payload).sort()).toEqual(['photos', 'values']);
  for (const key of ['intentId', 'proof', 'token', 'agreed', 'licenseWarranted', 'operationId']) {
    expect(Object.hasOwn(backup.payload.values, key)).toBe(false);
  }
}

test('manual original-photo backup survives reload beyond capability lifetime, restores order without sending, requires fresh consent', async ({ page }, info) => {
  test.setTimeout(90000);
  await isolateServerRateLimit(page, `198.18.${40 + info.retry}.${info.project.name === 'chromium' ? 41 : 42}`);
  const email = `synthetic-backup-${randomUUID()}@example.invalid`, name = `合成無期限下書き ${randomUUID()}`;
  const files = await pictures();
  await page.goto('/register'); await privacy(page);
  await populate(page, email, name, files);
  let transport = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && /^\/api\/salons(?:\/|$)/.test(new URL(request.url()).pathname)) transport++;
  });
  const backup = await downloadBackup(page);
  assertBackup(backup, files);
  expect(backup.payload.values).toMatchObject({ facility_name: name, email, seat_count: 0, staff_count: 2,
    business_hours: '10:00〜19:00', pr_text: '合成入力の復元と写真の順序を検証' });
  expect(transport).toBe(0);
  // Change Date only; timers/network remain real. This tests portable draft age,
  // not renewal or extension of any server-side proof or authentication token.
  await page.clock.setFixedTime(new Date(Date.now() + 8 * 86400000));
  await page.reload();
  await expect(page.locator('#reg-facility-name')).toBeEnabled();
  await expect(page.locator('#reg-facility-name')).toHaveValue('');
  await page.getByLabel('バックアップから入力を復元', { exact: true }).setInputFiles({
    name: 'synthetic-carelink-draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator('#reg-facility-name')).toHaveValue(name);
  await expect(page.locator('#reg-email')).toHaveValue(email);
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.locator('#reg-address')).toHaveValue('愛知県西尾市合成町1');
  await expect(page.locator('#reg-business-hours')).toHaveValue('10:00〜19:00');
  await expect(page.locator('#reg-seat-count')).toHaveValue('0');
  await expect(page.locator('#reg-staff-count')).toHaveValue('2');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await assertOriginalPreviews(page, files);
  await expect(page.locator('#reg-pr-text')).toHaveValue('合成入力の復元と写真の順序を検証');
  await expect(page.getByRole('checkbox', { name: /当施設の運営に法令上必要な許可/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /利用規約.*プライバシーポリシー/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '登録する', exact: true })).toBeDisabled();
  const restored = await downloadBackup(page);
  assertBackup(restored, files);
  expect(restored.payload).toEqual(backup.payload);
  // Editing a restored photo must survive leaving and returning to the photo
  // step; the restored snapshot must not overwrite the user's newer selection.
  const changedFiles = [files[0], { ...files[0], name: 'synthetic-replacement.png' }];
  await page.getByRole('button', { name: '内観 1の写真を削除', exact: true }).click();
  await page.getByLabel('内観 1の写真を選択', { exact: true }).setInputFiles(changedFiles[1]);
  await assertOriginalPreviews(page, changedFiles);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.locator('#reg-address')).toHaveValue('愛知県西尾市合成町1');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await assertOriginalPreviews(page, changedFiles);
  const editedBackup = await downloadBackup(page);
  assertBackup(editedBackup, changedFiles);
  expect(editedBackup.payload.values).toEqual(backup.payload.values);
  expect(transport).toBe(0);
  await page.getByRole('checkbox', { name: /この下書きはまだ送信していません/ }).check();
  const committed = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/salons/commit');
  await consentAndSubmit(page);
  expect((await committed).status()).toBe(201);
  await page.waitForURL(url => url.pathname === '/register/complete');
  const db = service();
  const receipt = await db.from('salons').select('facility_name,business_hours,seat_count,staff_count,pr_text,photo_urls').eq('email', email).single();
  expect(receipt.error).toBeNull();
  expect(receipt.data).toMatchObject({ facility_name: name, business_hours: '10:00〜19:00', seat_count: 0,
    staff_count: 2, pr_text: '合成入力の復元と写真の順序を検証' });
  expect(receipt.data!.photo_urls).toHaveLength(2);
});
