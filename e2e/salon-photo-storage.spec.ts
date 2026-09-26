import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

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

test('legacy photo upload works for anonymous and logged-in applicants; direct v2 paths are denied', async () => {
  for (const client of [anonymous, authenticated]) {
    const legacy = await client.storage.from(bucket).upload(`salons/${randomUUID()}/exterior.png`, png, { contentType: 'image/png' });
    expect(legacy.error === null && !!legacy.data, 'legacy synthetic image was not stored').toBe(true);
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
  expectServiceRejection(replay.error, 'immutable token replay');
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
