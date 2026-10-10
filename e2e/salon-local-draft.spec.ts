import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { SALON_LOCAL_DRAFT_DB, SALON_LOCAL_DRAFT_ID, SALON_LOCAL_DRAFT_STORE, SALON_LOCAL_DRAFT_TTL, type LocalSalonDraft } from '../src/lib/salon-local-draft';

// Browser-local synthetic input only. Every API/storage request is intercepted;
// there are no database fixtures, email sends or live registration side effects.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(() => {
  const base = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('local-draft browser checks require a loopback app');
});
async function isolated(context: BrowserContext) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/storage/')) return route.abort();
    return route.continue();
  });
}
async function raw(page: Page) {
  return page.evaluate(async ({ dbName, storeName, key }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('read failed'));
    });
    try {
      const row = await new Promise<Omit<LocalSalonDraft, 'backup'> & { backup: ArrayBuffer | null } | undefined>((resolve, reject) => {
        const request = db.transaction(storeName).objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('read failed'));
      });
      return row ? { revision: row.revision, state: row.state, expiresAt: row.expiresAt, updatedAt: row.updatedAt,
        hasBackup: row.backup !== null, sha256: row.sha256,
        keys: Object.keys(row).sort(), backup: row.backup ? JSON.parse(new TextDecoder().decode(row.backup)) : null } : null;
    } finally { db.close(); }
  }, { dbName: SALON_LOCAL_DRAFT_DB, storeName: SALON_LOCAL_DRAFT_STORE, key: SALON_LOCAL_DRAFT_ID });
}
const section = (page: Page) => page.getByRole('region', { name: 'この端末の下書き' });
const optIn = (page: Page) => section(page).getByRole('button', { name: 'この端末で下書きを自動保存する（7日間）' });
async function ready(page: Page, hasSavedDraft = false) {
  await page.goto('/register'); await expect(page.locator('#reg-facility-name')).toBeEnabled();
  if (hasSavedDraft) {
    await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeEnabled();
    await expect(optIn(page)).toBeDisabled();
  } else await expect(optIn(page)).toBeEnabled();
}
async function save(page: Page) {
  await optIn(page).click(); await expect(section(page).getByText('入力と元の写真を保存し、読み戻して確認しました。')).toBeVisible();
  return (await raw(page))!;
}
async function step3(page: Page) {
  await page.fill('#reg-facility-name', '端末下書きの合成店舗');
  await page.selectOption('#reg-business-type', { label: 'ヘアサロン' });
  await page.fill('#reg-rep-name', '合成代表'); await page.fill('#reg-contact-name', '合成担当');
  await page.fill('#reg-email', 'draft-browser@example.invalid'); await page.fill('#reg-phone', '09012345678');
  await page.getByRole('button', { name: '次へ' }).click(); await expect(page.locator('#reg-postal-code')).toBeVisible();
  await page.getByRole('button', { name: '次へ' }).click(); await expect(page.locator('#reg-desired-start-date')).toBeVisible();
}
async function submit(page: Page) {
  await page.locator('label', { hasText: '施術は必要な資格を有する者が提供する' }).locator('input').check();
  await page.locator('label', { hasText: '利用規約' }).locator('input').check();
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await page.getByRole('button', { name: '送信する', exact: true }).click();
}
test('opt-in retains original photo bytes and partial input across a real IndexedDB reload; consent is not restored', async ({ page, context }) => {
  await isolated(context); await ready(page); expect(await raw(page)).toBeNull();
  await step3(page);
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZsAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('メニュー 1の写真を選択').setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: original });
  await expect(page.getByRole('img', { name: 'メニュー 1', exact: true })).toBeVisible();
  const saved = await save(page);
  expect(saved.expiresAt - saved.updatedAt).toBe(SALON_LOCAL_DRAFT_TTL);
  expect(saved.backup.payload.photos[4]).toMatchObject({ name: 'original.png', type: 'image/png', size: original.length, base64: original.toString('base64') });
  expect(saved.keys).toEqual(['backup', 'expiresAt', 'id', 'revision', 'sha256', 'state', 'updatedAt']);
  expect(JSON.stringify(saved.backup)).not.toMatch(/intentId|proof|receiptId|recaptcha_token|agreed|licenseWarranted/);
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeEnabled();
  await expect(page.locator('#reg-facility-name')).toHaveValue('');
  await section(page).getByRole('button', { name: '端末の下書きを復元' }).click();
  await expect(page.locator('#reg-facility-name')).toHaveValue('端末下書きの合成店舗');
  await page.getByRole('button', { name: '次へ' }).click(); await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.getByRole('img', { name: 'メニュー 1', exact: true })).toBeVisible();
  await expect(page.locator('label', { hasText: '施術は必要な資格を有する者が提供する' }).locator('input')).not.toBeChecked();
  await expect(page.locator('label', { hasText: '利用規約' }).locator('input')).not.toBeChecked();
});
test('two actual browser tabs cannot overwrite an already advanced draft revision', async ({ page, context }) => {
  await isolated(context); await ready(page); await page.fill('#reg-facility-name', '先の入力'); const first = await save(page);
  const other = await context.newPage(); await ready(other, true);
  await expect(other.locator('#reg-facility-name')).toHaveValue('');
  expect((await raw(other))!.revision).toBe(first.revision);
  await section(other).getByRole('button', { name: '端末の下書きを復元' }).click();
  await expect(other.locator('#reg-facility-name')).toHaveValue('先の入力');
  await expect(optIn(other)).toBeEnabled();
  await page.fill('#reg-facility-name', '先のタブの新しい入力');
  await expect.poll(async () => (await raw(page))?.revision).toBeGreaterThan(first.revision);
  await optIn(other).click(); await expect(section(other).getByText(/別のタブで下書きが変更されました/)).toBeVisible();
  expect((await raw(page))!.backup.payload.values.facility_name).toBe('先のタブの新しい入力');
});
test('transport sees a committed fence; lost session context and failed clearing cannot make it restorable', async ({ page, context }) => {
  await isolated(context); await ready(page); await step3(page); const beforeTransport = await save(page);
  let attempted = false;
  await page.route('**/api/salons**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'POST') return route.abort();
    expect((await raw(page))?.state).toBe('locked');
    if (url.pathname === '/api/salons/prepare') return route.fulfill({ status: 201, json: {
      state: 'prepared', intentId: 'fda10000-0000-4000-8000-000000000001', consumerVersion: 2,
      photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
    } });
    attempted = true; return route.abort();
  });
  await submit(page); await expect.poll(() => attempted).toBe(true);
  await expect(page.getByText(/受付状況|送信結果/).first()).toBeVisible();
  await page.evaluate(() => sessionStorage.clear()); page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
  await expect(section(page).getByText(/別のタブやブラウザー再起動後も復元できません/)).toBeVisible();
  // Losing sessionStorage must not make the same manual file a fresh intent.
  await page.getByLabel('バックアップから入力を復元').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(beforeTransport.backup)) });
  await expect(page.getByText('下書きを復元できませんでした。入力と元の写真は変更されていません。')).toBeVisible();
  await expect(page.locator('#reg-facility-name')).toHaveValue('');
  expect(await raw(page)).toMatchObject({ state: 'locked', hasBackup: true });
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreIDBPut: () => void }).restoreIDBPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); }; });
  await section(page).getByRole('button', { name: '端末の下書きを削除' }).click();
  await expect(section(page).getByText(/端末の下書きを保存・確認できませんでした/)).toBeVisible();
  expect(await raw(page)).toMatchObject({ state: 'locked', hasBackup: true });
  await page.evaluate(() => (window as unknown as { restoreIDBPut: () => void }).restoreIDBPut());
  await section(page).getByRole('button', { name: '端末の下書きを削除' }).click();
  await expect.poll(async () => (await raw(page))?.hasBackup).toBe(false);
  expect((await raw(page))?.state).toBe('locked');
});
test('manual import of the same saved original input adopts its revision and fences the next transport without autosave opt-in', async ({ page, context }) => {
  await isolated(context); await ready(page); await step3(page); const saved = await save(page);
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(optIn(page)).toBeDisabled();
  await page.getByLabel('バックアップから入力を復元').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved.backup)) });
  await expect(page.locator('#reg-facility-name')).toHaveValue('端末下書きの合成店舗');
  await expect(optIn(page)).toBeEnabled();
  expect((await raw(page))?.revision).toBe(saved.revision);
  await page.locator('label', { hasText: 'この下書きはまだ送信していません' }).locator('input').check();
  await page.getByRole('button', { name: '次へ' }).click(); await page.getByRole('button', { name: '次へ' }).click();
  let attempted = false;
  await page.route('**/api/salons**', async route => {
    if (route.request().method() === 'POST') {
      expect(await raw(page)).toMatchObject({ state: 'locked', revision: saved.revision + 2 }); attempted = true;
    }
    return route.abort();
  });
  await submit(page); await expect.poll(() => attempted).toBe(true);
});
test('different manual input cannot replace a saved draft; explicit clearing permits fresh import without persistence', async ({ page, context }) => {
  await isolated(context); await ready(page); await page.fill('#reg-facility-name', '手動ファイルの元入力'); const earlier = await save(page);
  await page.fill('#reg-facility-name', '端末に残す別の入力');
  await expect.poll(async () => (await raw(page))?.revision).toBeGreaterThan(earlier.revision);
  const latest = await raw(page); page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(optIn(page)).toBeDisabled();
  const file = { name: 'synthetic-earlier.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(earlier.backup)) };
  await page.getByLabel('バックアップから入力を復元').setInputFiles(file);
  await expect(section(page).getByText(/他の下書きがこの端末に保存されています/)).toBeVisible();
  await expect(page.locator('#reg-facility-name')).toHaveValue('');
  expect((await raw(page))?.revision).toBe(latest!.revision);
  expect((await raw(page))?.backup.payload.values.facility_name).toBe('端末に残す別の入力');
  await section(page).getByRole('button', { name: '端末の下書きを削除' }).click();
  await expect.poll(async () => (await raw(page))?.hasBackup).toBe(false);
  const cleared = await raw(page);
  await page.getByLabel('バックアップから入力を復元').setInputFiles(file);
  await expect(page.locator('#reg-facility-name')).toHaveValue('手動ファイルの元入力');
  expect(await raw(page)).toMatchObject({ state: 'cleared', hasBackup: false, revision: cleared!.revision });
});
test('expired personal content is removed on next access, keeping a revision tombstone', async ({ page, context }) => {
  await isolated(context); await ready(page); await page.fill('#reg-email', 'partial@'); const saved = await save(page);
  await page.addInitScript(at => { Date.now = () => at; }, saved.expiresAt);
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await expect(optIn(page)).toBeEnabled();
  expect(await raw(page)).toMatchObject({ state: 'cleared', hasBackup: false, revision: saved.revision + 1 });
  await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
});
test('actual IndexedDB quota failure never shows a saved confirmation', async ({ page, context }) => {
  await isolated(context); await ready(page); await page.fill('#reg-facility-name', '失われない画面の入力');
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); }; });
  await optIn(page).click(); await expect(section(page).getByText(/端末の下書きを保存・確認できませんでした/)).toBeVisible();
  await expect(page.locator('#reg-facility-name')).toHaveValue('失われない画面の入力');
  expect(await raw(page)).toBeNull();
});
test('an old retirement-tab cookie blocks restoration until real boot cleanup and its retry verify both stores', async ({ page, context }) => {
  await isolated(context); await ready(page); await page.fill('#reg-facility-name', '退会前の合成下書き'); const saved = await save(page);
  const oldForm = await context.newPage(); await ready(oldForm, true);
  await page.evaluate(() => {
    sessionStorage.setItem('booking-draft:synthetic', JSON.stringify({ name: 'synthetic previous input' }));
    document.cookie = 'carelink_client_cleanup=1; Path=/; SameSite=Lax';
  });
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreIDBPut: () => void }).restoreIDBPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  });
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  const cleanupBanner = page.getByRole('alert', { name: '端末の下書き削除' });
  await expect(cleanupBanner.getByText(/削除を確認できませんでした/)).toBeVisible();
  await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
  await expect(optIn(page)).toBeDisabled();
  expect(await page.evaluate(() => document.cookie.includes('carelink_client_cleanup=1'))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('booking-draft:synthetic'))).toBeNull();
  expect(await raw(page)).toMatchObject({ state: 'saved', hasBackup: true, revision: saved.revision });
  await page.getByLabel('バックアップから入力を復元').setInputFiles({ name: 'retired-synthetic.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved.backup)) });
  await expect(page.getByText('下書きを復元できませんでした。入力と元の写真は変更されていません。')).toBeVisible();
  await expect(page.locator('#reg-facility-name')).toHaveValue('');
  await page.evaluate(() => (window as unknown as { restoreIDBPut: () => void }).restoreIDBPut());
  await cleanupBanner.getByRole('button', { name: '端末の下書き削除を再試行' }).click();
  await expect(cleanupBanner).toBeHidden(); await expect(optIn(page)).toBeEnabled();
  expect(await page.evaluate(() => document.cookie.includes('carelink_client_cleanup=1'))).toBe(false);
  expect(await raw(page)).toMatchObject({ state: 'cleared', hasBackup: false });
  await oldForm.getByRole('button', { name: '端末の下書きを復元' }).click();
  await expect(section(oldForm).getByText(/別のタブで下書きが変更されました/)).toBeVisible();
  await expect(oldForm.locator('#reg-facility-name')).toHaveValue('');
});
test('an explicit synthetic SIGNED_OUT broadcast wipes personal drafts; normal guest initialization retains them', async ({ page, context }) => {
  await isolated(context);
  await page.addInitScript(() => {
    const NativeChannel = BroadcastChannel; const names: string[] = [];
    (window as unknown as { syntheticAuthChannels: string[] }).syntheticAuthChannels = names;
    window.BroadcastChannel = class extends NativeChannel { constructor(name: string) { super(name); names.push(name); } };
  });
  await ready(page); await page.fill('#reg-facility-name', 'ゲスト本人が選んだ合成下書き'); const saved = await save(page);
  expect((await raw(page))?.revision).toBe(saved.revision);
  await page.evaluate(() => {
    sessionStorage.setItem('booking-draft:synthetic', JSON.stringify({ name: 'synthetic previous input' }));
    const names = (window as unknown as { syntheticAuthChannels: string[] }).syntheticAuthChannels;
    const name = names.find(value => value.startsWith('sb-') && value.endsWith('-auth-token'));
    if (!name) throw new Error('No local Supabase auth channel initialized');
    // Local guest context only, all network intercepted. This carries no
    // session/credential and cannot create an authenticated identity.
    const channel = new BroadcastChannel(name); channel.postMessage({ event: 'SIGNED_OUT', session: null }); channel.close();
  });
  await expect.poll(async () => (await raw(page))?.hasBackup).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('booking-draft:synthetic'))).toBeNull();
  await expect(section(page).getByRole('button', { name: '端末の下書きを復元' })).toBeDisabled();
  await expect(optIn(page)).toBeEnabled();
  expect(await page.evaluate(() => document.cookie.includes('carelink_client_cleanup=1'))).toBe(false);
});
