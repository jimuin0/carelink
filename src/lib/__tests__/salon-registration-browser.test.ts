/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { SalonRegistrationBrowser } from '../salon-registration-browser';
import { SALON_BROWSER_CONTEXT_KEY, readSalonBrowserContext, saveSalonBrowserContext } from '../salon-browser-context';
import { salonPhotoPath } from '../salon-photo-contract';
import type { SalonFormValues } from '../validations';

const intentId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const receiptId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const selectionId = '55555555-5555-4555-8555-555555555555';
const data: SalonFormValues = { facility_name: '合成施設', business_type: 'ヘアサロン',
  representative_name: '合成代表', contact_name: '合成担当', email: 'Fixture@example.invalid', phone: '09012345678' };
const response = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300,
  json: async () => body }) as Response;
const prepared = () => response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } });
const committed = () => response(201, { state: 'committed', receiptId });
const uncommitted = () => response(200, { state: 'uncommitted' });
function harness(phase?: 'prepared' | 'attempted' | 'confirmed') {
  const values = new Map<string, string>();
  const store = { getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { values.set(key, value); }) };
  if (phase) saveSalonBrowserContext(store, { version: 1, intentId, phase });
  const deps = { store, request: jest.fn(), uuid: jest.fn(() => selectionId),
    captcha: jest.fn(async () => null as string | null), compress: jest.fn(async (file: File) => file),
    upload: jest.fn(async () => ({ error: null })) };
  return { deps, values, engine: new SalonRegistrationBrowser(deps) };
}
const bodies = (request: jest.Mock, path: string) => request.mock.calls
  .filter(([url]) => url === path).map(([, init]) => JSON.parse(init.body));

test('native-style fetch is called without an arbitrary dependency-object receiver', async () => {
  const { deps, engine } = harness();
  deps.request.mockImplementation(async function (this: unknown, path: string) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return path === '/api/salons/prepare' ? prepared() : committed();
  });
  expect(await engine.submit(data, [])).toEqual({ state: 'confirmed', receiptId });
  expect(deps.request).toHaveBeenCalledTimes(2);
});

test('prepare, persist selector before commit, canonicalize optional numbers, and confirm exactly once', async () => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockImplementationOnce(async () => {
    expect(readSalonBrowserContext(deps.store)).toEqual({ state: 'ready', context: { version: 1, intentId, phase: 'attempted' } });
    return committed();
  });
  expect(await engine.submit({ ...data, seat_count: NaN, staff_count: 0 }, [null])).toEqual({ state: 'confirmed', receiptId });
  expect(bodies(deps.request, '/api/salons/commit')[0]).toMatchObject({ intentId, photoIds: [],
    registration: { email: 'fixture@example.invalid', phone: '09012345678', seat_count: null, staff_count: 0 } });
  const stored = deps.store.getItem(SALON_BROWSER_CONTEXT_KEY)!;
  expect(JSON.parse(stored)).toEqual({ version: 1, intentId, phase: 'confirmed' });
  expect(stored).not.toContain('fixture');
});

test('lost commit response reconciles committed receipt without a second write', async () => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(response(200, { state: 'committed', receiptId }));
  expect((await engine.submit(data, [])).state).toBe('unknown');
  expect(await engine.retryUnknown()).toEqual({ state: 'confirmed', receiptId });
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(1);
});

test('verified uncommitted result permits only the identical in-memory body replay', async () => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(202, { state: 'unknown' }))
    .mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(response(200, { state: 'replay', receiptId }));
  expect((await engine.submit(data, [])).state).toBe('unknown');
  expect(await engine.retryUnknown()).toEqual({ state: 'confirmed', receiptId });
  const commits = bodies(deps.request, '/api/salons/commit');
  expect(commits).toHaveLength(2); expect(commits[1]).toEqual(commits[0]);
  expect(bodies(deps.request, '/api/salons/prepare')).toHaveLength(1);
});

test('status outage cannot authorize a replay', async () => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(response(503, {}));
  await engine.submit(data, []);
  expect((await engine.retryUnknown()).state).toBe('unknown');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(1);
});

test('reload with attempted state never reconstructs a new body or new intent', async () => {
  const { deps, engine } = harness('attempted');
  deps.request.mockResolvedValue(uncommitted());
  expect((await engine.retryUnknown()).state).toBe('unknown');
  expect((await engine.submit(data, [])).state).toBe('unknown');
  expect(deps.request.mock.calls.every(([url]) => url === '/api/salons/status')).toBe(true);
});

test.each(['removed', 'replaced'])('context %s during commit is not overwritten or displayed as success', async mode => {
  const { deps, values, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockImplementationOnce(async () => {
    if (mode === 'removed') values.clear();
    else saveSalonBrowserContext(deps.store, { version: 1, intentId: otherId, phase: 'prepared' });
    return committed();
  });
  expect((await engine.submit(data, [])).state).toBe('blocked');
  expect(readSalonBrowserContext(deps.store)).toEqual(mode === 'removed' ? { state: 'empty' }
    : { state: 'ready', context: { version: 1, intentId: otherId, phase: 'prepared' } });
});

test('storage failure after prepare never commits', async () => {
  const { deps, engine } = harness();
  deps.store.setItem.mockImplementation(() => { throw new Error('quota'); });
  deps.request.mockResolvedValueOnce(prepared());
  expect((await engine.submit(data, [])).state).toBe('blocked');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
});

test.each([{}, { state: 'committed', receiptId: 'invalid' }, null])('malformed commit success %j remains unknown', async body => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(201, body));
  expect((await engine.submit(data, [])).state).toBe('unknown');
});

test('explicit invalid rejection allows corrected input on the same intent', async () => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(400, { state: 'invalid' }))
    .mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(committed());
  expect((await engine.submit(data, [])).state).toBe('retryable');
  expect((await engine.submit({ ...data, facility_name: '修正合成施設' }, [])).state).toBe('confirmed');
  expect(bodies(deps.request, '/api/salons/prepare')).toHaveLength(1);
  expect(bodies(deps.request, '/api/salons/commit')[1].registration.facility_name).toBe('修正合成施設');
});

test('lost upload acknowledgement is resolved by the same manifest, never a new selection', async () => {
  const { deps, engine } = harness();
  const file = new File(['image'], 'fixture.jpg', { type: 'image/jpeg' });
  const path = salonPhotoPath(intentId, photoId, file.type);
  deps.request.mockResolvedValueOnce(prepared())
    .mockResolvedValueOnce(response(200, { state: 'upload', photoId, path, token: 'synthetic-capability' }))
    .mockResolvedValueOnce(response(200, { state: 'uploaded', photoId, path })).mockResolvedValueOnce(committed());
  deps.upload.mockRejectedValueOnce(new Error('ack lost'));
  expect((await engine.submit(data, [null, null, null, null, file])).state).toBe('confirmed');
  const photos = bodies(deps.request, '/api/salons/photos');
  expect(photos).toHaveLength(2); expect(photos[1]).toEqual(photos[0]); expect(photos[0].slot).toBe(4);
  expect(deps.uuid).toHaveBeenCalledTimes(1);
  expect(bodies(deps.request, '/api/salons/commit')[0].photoIds).toEqual([photoId]);
  expect(deps.store.getItem(SALON_BROWSER_CONTEXT_KEY)).not.toContain('synthetic-capability');
});

test('unconfirmed photo retry keeps compressed file and selection, then reuses uploaded object', async () => {
  const { deps, engine } = harness();
  const file = new File(['image'], 'fixture.jpg', { type: 'image/jpeg' });
  const path = salonPhotoPath(intentId, photoId, file.type);
  deps.request.mockResolvedValueOnce(prepared())
    .mockResolvedValueOnce(response(200, { state: 'upload', photoId, path, token: 'synthetic' }))
    .mockResolvedValueOnce(response(503, {})).mockResolvedValueOnce(uncommitted())
    .mockResolvedValueOnce(response(200, { state: 'uploaded', photoId, path })).mockResolvedValueOnce(committed());
  expect((await engine.submit(data, [file])).state).toBe('retryable');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
  expect((await engine.submit(data, [file])).state).toBe('confirmed');
  expect(deps.compress).toHaveBeenCalledTimes(1); expect(deps.uuid).toHaveBeenCalledTimes(1);
  expect(deps.upload).toHaveBeenCalledTimes(1);
  expect(new Set(bodies(deps.request, '/api/salons/photos').map(x => x.selectionId))).toEqual(new Set([selectionId]));
});

test.each(['path', 'id', 'token', 'state'])('invalid photo %s prevents upload and commit', async invalid => {
  const { deps, engine } = harness();
  const file = new File(['image'], 'fixture.jpg', { type: 'image/jpeg' });
  const body = { state: 'upload', photoId, path: salonPhotoPath(intentId, photoId, file.type), token: 'synthetic',
    ...(invalid === 'path' ? { path: 'other/file.jpg' } : invalid === 'id' ? { photoId: 'invalid' }
      : invalid === 'token' ? { token: '' } : { state: 'unknown' }) };
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(200, body));
  expect((await engine.submit(data, [file])).state).toBe('retryable');
  expect(deps.upload).not.toHaveBeenCalled(); expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
});

test('invalid input, too many slots, corrupt context and expired intent never allocate a replacement', async () => {
  const { deps, values, engine } = harness();
  expect((await engine.submit({ ...data, facility_name: '' }, [])).state).toBe('retryable');
  expect((await engine.submit(data, Array(8).fill(null))).state).toBe('retryable');
  values.set(SALON_BROWSER_CONTEXT_KEY, '{');
  expect((await engine.submit(data, [])).state).toBe('blocked');
  expect(deps.request).not.toHaveBeenCalled();
  saveSalonBrowserContext(deps.store, { version: 1, intentId, phase: 'prepared' });
  deps.request.mockResolvedValueOnce(response(410, { state: 'expired' }));
  expect((await engine.submit(data, [])).state).toBe('blocked');
  expect(bodies(deps.request, '/api/salons/prepare')).toHaveLength(0);
});

test.each([null, {}, { state: 'committed', receiptId: 'bad' }, { state: 'expired' }])('invalid status response %j is not accepted', async body => {
  const { deps, engine } = harness('prepared');
  deps.request.mockResolvedValueOnce(response(200, body));
  expect((await engine.reconcile()).state).toBe('blocked');
});
test('status result cannot overwrite a newer selection', async () => {
  const { deps, engine } = harness('prepared');
  deps.request.mockImplementationOnce(async () => {
    saveSalonBrowserContext(deps.store, { version: 1, intentId: otherId, phase: 'prepared' });
    return response(200, { state: 'committed', receiptId });
  });
  expect((await engine.reconcile()).state).toBe('blocked');
});
test('captcha and compression fallback keep the canonical contract', async () => {
  const { deps, engine } = harness();
  deps.captcha.mockResolvedValueOnce('synthetic-captcha');
  deps.compress.mockRejectedValueOnce(new Error('image decoder failed'));
  const file = new File(['image'], 'fixture.jpg', { type: 'image/jpeg' });
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(200,
    { state: 'uploaded', photoId, path: salonPhotoPath(intentId, photoId, file.type) })).mockResolvedValueOnce(committed());
  expect((await engine.submit({ ...data, staff_count: NaN }, [file])).state).toBe('confirmed');
  expect(bodies(deps.request, '/api/salons/prepare')).toEqual([{ recaptcha_token: 'synthetic-captcha' }]);
  expect(bodies(deps.request, '/api/salons/commit')[0].registration.staff_count).toBeNull();
});
test('captcha exception performs no request', async () => {
  const { deps, engine } = harness(); deps.captcha.mockRejectedValueOnce(new Error('captcha failure'));
  expect((await engine.submit(data, [])).state).toBe('retryable'); expect(deps.request).not.toHaveBeenCalled();
});
test.each([response(503, {}), response(200, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }),
  response(201, { state: 'unknown' }), response(201, { state: 'prepared', intentId: 'bad' })])('failed preparation never commits %#', async result => {
  const { deps, engine } = harness(); deps.request.mockResolvedValueOnce(result);
  expect((await engine.submit(data, [])).state).toBe('retryable');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
});
test('context removed between status read and the next selector read prevents commit', async () => {
  const { deps, engine } = harness('prepared');
  deps.request.mockResolvedValueOnce(uncommitted());
  // No asynchronous operation is needed: storage itself can become unavailable.
  deps.store.getItem.mockReturnValueOnce(JSON.stringify({ version: 1, intentId, phase: 'prepared' }))
    .mockImplementationOnce(() => { throw new Error('storage denied'); });
  expect((await engine.submit(data, [])).state).toBe('blocked');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
});
test('context lost while preparing photos prevents the first commit', async () => {
  const { deps, values, engine } = harness();
  const file = new File(['image'], 'fixture.jpg', { type: 'image/jpeg' });
  deps.request.mockResolvedValueOnce(prepared()).mockImplementationOnce(async () => {
    values.clear(); return response(200, { state: 'uploaded', photoId, path: salonPhotoPath(intentId, photoId, file.type) });
  });
  expect((await engine.submit(data, [file])).state).toBe('blocked');
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
});
test('an invalid commit response cannot reset a concurrently changed selector', async () => {
  const { deps, values, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockImplementationOnce(async () => {
    values.clear(); return response(400, { state: 'invalid' });
  });
  expect((await engine.submit(data, [])).state).toBe('blocked');
});
test.each([undefined, null, [], 'invalid', { contact_phone: 'PRIVATE raw input', unknown: 'PRIVATE' }])('server fields are allowlisted fixed messages %#', async fieldErrors => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(400, { state: 'invalid', fieldErrors }));
  const result = await engine.submit(data, []);
  expect(result).toEqual({ state: 'retryable', message: '入力内容を確認してください。申込はまだ確定していません。',
    fieldErrors: fieldErrors && !Array.isArray(fieldErrors) && typeof fieldErrors === 'object'
      ? { contact_phone: '担当者直通電話を確認してください' } : {} });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test.each([{}, { consumerVersion: 1 }, { consumerVersion: 2, photoLimits: { maxBytes: 10485761, mimeTypes: ['image/jpeg'] } }])('malformed new handshake preserves its selector and refreshes without a replacement %#', async handshake => {
  const { deps, engine } = harness();
  deps.request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, ...handshake }));
  expect((await engine.submit(data, [])).state).toBe('retryable');
  expect(readSalonBrowserContext(deps.store)).toEqual({ state: 'ready', context: { version: 1, intentId, phase: 'prepared' } });
  expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0);
  deps.request.mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(response(200, { state: 'prepared', intentId,
    consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg'] } })).mockResolvedValueOnce(committed());
  expect((await engine.submit(data, [])).state).toBe('confirmed');
  expect(bodies(deps.request, '/api/salons/prepare')).toEqual([{}, { intentId }]);
  expect(deps.captcha).toHaveBeenCalledTimes(1);
});
test.each([
 response(503, {}), response(201, { state: 'prepared', intentId }), response(200, { state: 'unknown', intentId }),
 response(200, { state: 'prepared', intentId: otherId }), response(200, { state: 'prepared', intentId, consumerVersion: 1 }),
 response(200, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 0, mimeTypes: [] } }),
])('refresh failure preserves fixed intent and never commits/uploads %#', async result => {
 const { deps, engine } = harness('prepared'); deps.request.mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(result);
 expect((await engine.submit(data, [])).state).toBe('retryable');
 expect(bodies(deps.request, '/api/salons/prepare')).toEqual([{ intentId }]);
 expect(bodies(deps.request, '/api/salons/commit')).toHaveLength(0); expect(deps.upload).not.toHaveBeenCalled();
 expect(readSalonBrowserContext(deps.store)).toEqual({ state: 'ready', context: { version: 1, intentId, phase: 'prepared' } });
});
test.each(['missing','other','attempted'])('selector change during refresh %s blocks any manifest allocation', async mode => {
 const { deps, values, engine } = harness('prepared'); deps.request.mockResolvedValueOnce(uncommitted()).mockImplementationOnce(async () => {
  if (mode === 'missing') values.clear();
  else saveSalonBrowserContext(deps.store, { version: 1, intentId: mode === 'other' ? otherId : intentId, phase: mode === 'attempted' ? 'attempted' : 'prepared' });
  return response(200, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10, mimeTypes: ['image/jpeg'] } });
 });
 expect((await engine.submit(data, [new File(['jpeg'], 'synthetic.jpg', { type: 'image/jpeg' })])).state).toBe('blocked');
 expect(bodies(deps.request, '/api/salons/photos')).toHaveLength(0); expect(deps.upload).not.toHaveBeenCalled();
});
test.each(['size', 'mime'])('stricter handshake %s preserves originals and explains limits before manifest/signing', async kind => {
 const { deps, engine } = harness();
 const file = new File(['jpeg'], 'synthetic.jpg', { type: 'image/jpeg' });
 deps.request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2,
  photoLimits: { maxBytes: kind === 'size' ? 3 : 10, mimeTypes: kind === 'mime' ? ['image/png'] : ['image/jpeg'] } }));
 const result = await engine.submit(data, [file]); expect(result.state).toBe('retryable');
 expect(result).toEqual(expect.objectContaining({ message: expect.stringContaining('元の写真は保持されています') }));
 expect(bodies(deps.request, '/api/salons/photos')).toHaveLength(0); expect(deps.upload).not.toHaveBeenCalled();
 expect(file.size).toBe(4);
});

test('local input may be revised only before this coordinator has ever attempted a commit', async () => {
 const { deps, engine } = harness(); expect(engine.canReviseUnsubmittedInput()).toBe(true);
 deps.request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 1, mimeTypes: ['image/jpeg'] } }));
 expect((await engine.submit(data, [new File(['too-large'], 'synthetic.jpg', { type: 'image/jpeg' })])).state).toBe('retryable');
 expect(engine.canReviseUnsubmittedInput()).toBe(true);
 deps.request.mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(response(400, { state: 'invalid' }));
 expect((await engine.submit(data, [])).state).toBe('retryable');
 expect(readSalonBrowserContext(deps.store)).toMatchObject({ context: { phase: 'prepared' } });
 expect(engine.canReviseUnsubmittedInput()).toBe(false);
});
test.each(['prepared','attempted','confirmed'] as const)('historical %s context is not proof of never committing', phase => {
 const { engine } = harness(phase); expect(engine.canReviseUnsubmittedInput()).toBe(false);
});
test('changed/corrupt selector cannot release a local pretransport input fence', async () => {
 const { deps, values, engine } = harness();
 deps.request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 1 }));
 expect((await engine.submit(data, [])).state).toBe('retryable');
 saveSalonBrowserContext(deps.store, { version: 1, intentId: otherId, phase: 'prepared' });
 expect(engine.canReviseUnsubmittedInput()).toBe(false);
 values.set(SALON_BROWSER_CONTEXT_KEY, '{'); expect(engine.canReviseUnsubmittedInput()).toBe(false);
});

test('a narrower PNG-only bucket preserves the accepted original when compression converts it to JPEG', async () => {
 const { deps, engine } = harness(); const original = new File(['png'], 'original.png', { type: 'image/png' });
 deps.compress.mockResolvedValue(new File(['jpg'], 'compressed.jpg', { type: 'image/jpeg' }));
 deps.request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10, mimeTypes: ['image/png'] } }))
  .mockResolvedValueOnce(response(200, { state: 'uploaded', photoId, path: salonPhotoPath(intentId, photoId, 'image/png') }))
  .mockResolvedValueOnce(committed());
 expect((await engine.submit(data, [original])).state).toBe('confirmed');
 expect(bodies(deps.request, '/api/salons/photos')[0]).toMatchObject({ byteSize: original.size, mimeType: 'image/png' });
 expect(original.name).toBe('original.png');
});

test('a live restriction changed after handshake refreshes the same intent and does not rewrite a fixed selection', async () => {
 const { deps, engine } = harness(); const original = new File(['jpeg'], 'original.jpg', { type: 'image/jpeg' });
 deps.request.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(400, { state: 'invalid' }));
 expect((await engine.submit(data, [original])).state).toBe('retryable');
 deps.request.mockResolvedValueOnce(uncommitted()).mockResolvedValueOnce(response(200, { state: 'prepared', intentId,
  consumerVersion: 2, photoLimits: { maxBytes: 3, mimeTypes: ['image/jpeg'] } }));
 expect((await engine.submit(data, [original])).state).toBe('retryable');
 expect(bodies(deps.request, '/api/salons/prepare')).toEqual([{}, { intentId }]);
 expect(bodies(deps.request, '/api/salons/photos')).toHaveLength(1);
 expect(deps.compress).toHaveBeenCalledTimes(1); expect(deps.uuid).toHaveBeenCalledTimes(1); expect(deps.upload).not.toHaveBeenCalled();
});
