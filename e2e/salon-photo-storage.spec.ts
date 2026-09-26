import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { businessTypes } from '../src/lib/constants';

// Trace captures HTTP Set-Cookie/JSON tokens even with synthetic identities.
// Do not persist capabilities in retry traces, screenshots or videos.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

// Infrastructure contracts, not evidence that the v2 registration UI is wired.
// No hosted credentials, applicants, emails or business notifications are used.
const bucket = 'carelink-uploads';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZsAAAAASUVORK5CYII=', 'base64');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
let service: SupabaseClient;
let anonymous: SupabaseClient;
let authenticated: SupabaseClient;

test.beforeAll(async () => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('photo storage contracts require the managed disposable HTTPS CI lifecycle');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
  anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  authenticated = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const email = `photo-contract-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('synthetic photo identity creation failed');
  const loggedIn = await authenticated.auth.signInWithPassword({ email, password });
  if (loggedIn.error || !loggedIn.data.session) throw new Error('synthetic photo identity login failed');
});

async function signed(path: string) {
  const result = await service.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
  if (result.error || !result.data || result.data.path !== path) throw new Error('synthetic signed upload preparation failed');
  return result.data.token;
}

async function contents(path: string) {
  const result = await service.storage.from(bucket).download(path);
  if (result.error || !result.data) throw new Error('synthetic photo object read failed');
  return Buffer.from(await result.data.arrayBuffer());
}

function expectServiceRejection(error: unknown, operation: string) {
  // SDK fetch failures are StorageUnknownError, not server rejections. Never
  // count a timeout, unauthenticated client, missing endpoint or 5xx as a pass.
  const failure = error as { name?: string; status?: number; statusCode?: string } | null;
  expect(failure?.name, `${operation}: expected a Storage API rejection`).toBe('StorageApiError');
  expect([400, 403, 409, 413, 415, 422], `${operation}: unexpected HTTP failure`).toContain(failure?.status);
  expect(typeof failure?.statusCode === 'string' && failure.statusCode.length > 0,
    `${operation}: missing service error code`).toBe(true);
}

function expectDuplicate(error: unknown) {
  // Invalid/expired capabilities, RLS denials and outages are not evidence
  // that a valid signed capability refuses overwriting an existing object.
  expect(error).toMatchObject({ name: 'StorageApiError', statusCode: '409', message: 'The resource already exists' });
  expect([400, 409]).toContain((error as { status?: number }).status);
}

function isUploadToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

test('both public roles must use signed uploads, including the historical prefix', async () => {
  for (const client of [anonymous, authenticated]) {
    const legacy = await client.storage.from(bucket).upload(`salons/${randomUUID()}/exterior.png`, png, { contentType: 'image/png' });
    expectServiceRejection(legacy.error, 'unsigned legacy upload');
    expect(legacy.data).toBeNull();
    const direct = await client.storage.from(bucket).upload(`salon-intents/${randomUUID()}/${randomUUID()}.png`, png, { contentType: 'image/png' });
    expectServiceRejection(direct.error, 'direct v2 upload');
    expect(direct.data).toBeNull();
    const outside = await client.storage.from(bucket).upload(`other/${randomUUID()}.png`, png, { contentType: 'image/png' });
    expectServiceRejection(outside.error, 'unscoped legacy path');
    expect(outside.data).toBeNull();
  }
});

test('signed v2 upload is immutable against token replay, update and delete by either public role', async () => {
  const path = `salon-intents/${randomUUID()}/${randomUUID()}.png`;
  const absent = await service.storage.from(bucket).info(path);
  expect(absent.data).toBeNull();
  expect(absent.error).toMatchObject({ name: 'StorageApiError', message: 'Object not found', statusCode: '404' });
  expect([400, 404]).toContain(absent.error?.status);
  const token = await signed(path);
  const uploaded = await anonymous.storage.from(bucket).uploadToSignedUrl(path, token, png, { contentType: 'image/png' });
  expect(uploaded.error === null && !!uploaded.data, 'signed synthetic image was not stored').toBe(true);
  const original = await contents(path);
  expect(original.equals(png)).toBe(true);
  const metadata = await service.storage.from(bucket).info(path);
  if (metadata.error || !metadata.data) throw new Error('synthetic photo metadata unavailable');
  expect({ bucketId: metadata.data.bucketId, name: metadata.data.name,
    size: metadata.data.size, contentType: metadata.data.contentType }).toEqual({
    bucketId: bucket, name: path, size: png.length, contentType: 'image/png',
  });
  const replacement = Buffer.concat([png, Buffer.from('replacement')]);
  const replay = await anonymous.storage.from(bucket).uploadToSignedUrl(path, token, replacement, { contentType: 'image/png', upsert: true });
  expectDuplicate(replay.error);
  for (const client of [anonymous, authenticated]) {
    const updated = await client.storage.from(bucket).update(path, replacement, { contentType: 'image/png' });
    expectServiceRejection(updated.error, 'public role overwrite');
    const removed = await client.storage.from(bucket).remove([path]);
    // DELETE with no visible rows may return an empty success instead of 403.
    if (removed.error) expectServiceRejection(removed.error, 'public role delete');
    else expect(Array.isArray(removed.data) && removed.data.length === 0).toBe(true);
    expect((await contents(path)).equals(original), 'denied mutation changed the object').toBe(true);
  }
});

test('Storage enforces image MIME and the 10MiB bound for signed uploads', async () => {
  test.setTimeout(120_000);
  const maxBytes = 10 * 1024 * 1024;
  const exact = Buffer.alloc(maxBytes);
  png.copy(exact);
  const exactPath = `salon-intents/${randomUUID()}/${randomUUID()}.png`;
  const accepted = await anonymous.storage.from(bucket).uploadToSignedUrl(exactPath, await signed(exactPath), exact, { contentType: 'image/png' });
  expect(accepted.error === null && !!accepted.data, 'exact size boundary must be accepted').toBe(true);
  expect((await contents(exactPath)).length).toBe(maxBytes);
  const oversizedPath = `salon-intents/${randomUUID()}/${randomUUID()}.png`;
  const oversized = await anonymous.storage.from(bucket).uploadToSignedUrl(oversizedPath, await signed(oversizedPath), Buffer.alloc(maxBytes + 1), { contentType: 'image/png' });
  expectServiceRejection(oversized.error, 'oversized image');
  expect(oversized.data).toBeNull();
  const unsafePath = `salon-intents/${randomUUID()}/${randomUUID()}.png`;
  const unsafe = await anonymous.storage.from(bucket).uploadToSignedUrl(unsafePath, await signed(unsafePath), '<svg/>', { contentType: 'image/svg+xml' });
  expectServiceRejection(unsafe.error, 'unsafe declared MIME');
  expect(unsafe.data).toBeNull();
});

test('photo API reconciles the same capability and refuses altered metadata or missing proof', async ({ request }) => {
  const headers = { origin: 'https://localhost:3000', 'x-real-ip': `198.18.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}` };
  const prepared = await request.post('/api/salons/prepare', { headers, data: {} });
  expect(prepared.status()).toBe(201);
  const intent = await prepared.json();
  expect(intent.state).toBe('prepared');
  expect(intent.proof).toBeUndefined();
  const input = { intentId: intent.intentId, selectionId: randomUUID(), slot: 0, mimeType: 'image/png', byteSize: png.length };
  const [issuance, concurrent] = await Promise.all([
    request.post('/api/salons/photos', { headers, data: input }),
    request.post('/api/salons/photos', { headers, data: input }),
  ]);
  expect(issuance.status()).toBe(200);
  expect(concurrent.status()).toBe(200);
  const upload = await issuance.json();
  const same = await concurrent.json();
  expect(upload.state).toBe('upload');
  expect(same.state).toBe('upload');
  expect(same.photoId).toBe(upload.photoId);
  expect(same.path).toBe(upload.path);
  if (!isUploadToken(upload.token) || !isUploadToken(same.token) || typeof upload.path !== 'string') {
    throw new Error('photo API did not issue a usable synthetic capability');
  }
  const stored = await anonymous.storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, png, { contentType: 'image/png' });
  expect(stored.error === null && !!stored.data).toBe(true);
  const overwrite = await anonymous.storage.from(bucket).uploadToSignedUrl(same.path, same.token, Buffer.concat([png, png]), { contentType: 'image/png', upsert: true });
  expectDuplicate(overwrite.error);
  const invalidToken = await anonymous.storage.from(bucket).uploadToSignedUrl(upload.path, 'invalid-fixture-token', png, { contentType: 'image/png', upsert: true });
  expectServiceRejection(invalidToken.error, 'invalid capability control');
  expect(() => expectDuplicate(invalidToken.error)).toThrow();
  // Models loss of the upload response: query the same selection rather than
  // uploading again. Neither an overwrite nor a second manifest is necessary.
  const reconciled = await request.post('/api/salons/photos', { headers, data: input });
  expect(reconciled.status()).toBe(200);
  const existing = await reconciled.json();
  expect(existing.state).toBe('uploaded');
  expect(existing.photoId).toBe(upload.photoId);
  expect(existing.path).toBe(upload.path);
  expect(existing.token).toBeUndefined();
  const conflict = await request.post('/api/salons/photos', { headers, data: { ...input, byteSize: png.length + 1 } });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).state).toBe('conflict');
  const unauthorized = await request.post('/api/salons/photos', { headers: { ...headers, cookie: '' }, data: input });
  expect(unauthorized.status()).toBe(403);
  const otherPreparation = await request.post('/api/salons/prepare', { headers, data: {} });
  expect(otherPreparation.status()).toBe(201);
  // Synthetic capabilities stay in memory and are never printed. A valid
  // proof for another intent must fail at the real RPC, not only syntax checks.
  const otherCookie = otherPreparation.headers()['set-cookie'];
  const otherProof = otherCookie?.split(';')[0].split('=')[1];
  if (!otherProof || !/^[a-f0-9]{64}$/.test(otherProof)) throw new Error('synthetic preparation cookie missing');
  const crossIntent = await request.post('/api/salons/photos', {
    headers: { ...headers, cookie: `carelink_salon_intent_${intent.intentId}=${otherProof}` }, data: input,
  });
  expect(crossIntent.status()).toBe(403);
  const wrongOrigin = await request.post('/api/salons/photos', { headers: { ...headers, origin: 'https://foreign.invalid' }, data: input });
  expect(wrongOrigin.status()).toBe(403);
  expect((await contents(upload.path)).equals(png)).toBe(true);
});

const registration = { facility_name: 'Synthetic CI facility', business_type: businessTypes[0],
  representative_name: 'Synthetic', contact_name: 'Synthetic', email: 'registration-contract@example.invalid',
  phone: '09012345678', source: 'register' };

test('atomic registration API returns one receipt and two logical notifications for concurrent retries', async ({ request }) => {
  const headers = { origin: 'https://localhost:3000', 'x-real-ip': `198.19.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}` };
  const prep = await request.post('/api/salons/prepare', { headers, data: {} });
  expect(prep.status()).toBe(201);
  const { intentId } = await prep.json();
  const data = { intentId, registration, photoIds: [] };
  const results = await Promise.all([request.post('/api/salons/commit', { headers, data }), request.post('/api/salons/commit', { headers, data })]);
  expect(results.map(result => result.status()).sort()).toEqual([200, 201]);
  const bodies = await Promise.all(results.map(result => result.json()));
  expect(bodies.map(body => body.state).sort()).toEqual(['committed', 'replay']);
  const receiptId = bodies[0].receiptId;
  expect(bodies[1].receiptId).toBe(receiptId);
  const salons = await service.from('salons').select('id', { count: 'exact', head: true }).eq('id', receiptId);
  expect(salons.error).toBeNull(); expect(salons.count).toBe(1);
  const queue = await service.from('webhook_retry_queue').select('notification_kind').eq('registration_id', receiptId);
  expect(queue.error).toBeNull(); expect(queue.data?.map(row => row.notification_kind).sort()).toEqual(['internal', 'receipt']);
  const conflict = await request.post('/api/salons/commit', { headers, data: { ...data, registration: { ...registration, facility_name: 'different facility' } } });
  expect(conflict.status()).toBe(409); expect((await conflict.json()).state).toBe('conflict');
  const unauthorized = await request.post('/api/salons/commit', { headers: { ...headers, cookie: '' }, data });
  expect(unauthorized.status()).toBe(403);
  const wrongOrigin = await request.post('/api/salons/commit', { headers: { ...headers, origin: 'https://foreign.invalid' }, data });
  expect(wrongOrigin.status()).toBe(403);
  const status = await request.post('/api/salons/status', { headers, data: { intentId } });
  expect(status.status()).toBe(200); expect(await status.json()).toEqual({ state: 'committed', receiptId });
});

test('photo ownership is required and lost commit response is recovered without another application', async ({ page }) => {
  const headers = { origin: 'https://localhost:3000', 'x-real-ip': `198.19.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}` };
  const request = page.request;
  const prep = await request.post('/api/salons/prepare', { headers, data: {} });
  expect(prep.status()).toBe(201);
  const { intentId } = await prep.json();
  const selection = { intentId, selectionId: randomUUID(), slot: 0, mimeType: 'image/png', byteSize: png.length };
  const photoResponse = await request.post('/api/salons/photos', { headers, data: selection });
  expect(photoResponse.status()).toBe(200);
  const photo = await photoResponse.json();
  expect(photo.state).toBe('upload');
  if (!isUploadToken(photo.token) || typeof photo.path !== 'string') throw new Error('synthetic upload capability unavailable');
  const data = { intentId, registration, photoIds: [photo.photoId] };
  const premature = await request.post('/api/salons/commit', { headers, data });
  expect(premature.status()).toBe(409); expect((await premature.json()).state).toBe('photo_unverified');
  const uploaded = await anonymous.storage.from(bucket).uploadToSignedUrl(photo.path, photo.token, png, { contentType: 'image/png' });
  expect(uploaded.error).toBeNull();
  const otherPrep = await request.post('/api/salons/prepare', { headers, data: {} });
  expect(otherPrep.status()).toBe(201);
  const other = await otherPrep.json();
  const foreignPhoto = await request.post('/api/salons/commit', { headers, data: { ...data, intentId: other.intentId } });
  expect(foreignPhoto.status()).toBe(409); expect((await foreignPhoto.json()).state).toBe('photo_unverified');
  const foreignStatus = await request.post('/api/salons/status', { headers, data: { intentId: other.intentId } });
  expect(await foreignStatus.json()).toEqual({ state: 'uncommitted' });
  await page.goto('/register');
  let committedUpstream = false;
  await page.route('**/api/salons/commit', async route => {
    const upstream = await route.fetch();
    committedUpstream = upstream.status() === 201 && (await upstream.json()).state === 'committed';
    await route.abort('connectionreset');
  });
  const outcome = await page.evaluate(async ({ data, headers }) => {
    try { await fetch('/api/salons/commit', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return 'unexpected-response'; }
    catch { return 'response-lost'; }
  }, { data, headers });
  expect(outcome).toBe('response-lost'); expect(committedUpstream).toBe(true);
  const recovered = await request.post('/api/salons/status', { headers, data: { intentId } });
  expect(recovered.status()).toBe(200);
  const status = await recovered.json(); expect(status.state).toBe('committed');
  const rows = await service.from('salons').select('id,photo_urls').eq('id', status.receiptId);
  expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1);
  expect(rows.data![0].photo_urls).toEqual([service.storage.from(bucket).getPublicUrl(photo.path).data.publicUrl]);
  const replay = await request.post('/api/salons/commit', { headers, data });
  expect(replay.status()).toBe(200); expect(await replay.json()).toEqual({ state: 'replay', receiptId: status.receiptId });
  const count = await service.from('webhook_retry_queue').select('id', { count: 'exact', head: true }).eq('registration_id', status.receiptId);
  expect(count.error).toBeNull(); expect(count.count).toBe(2);
  expect((await contents(photo.path)).equals(png)).toBe(true);
});
