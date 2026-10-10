/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
let cookie: string, written: string, fault: string;
let marker: typeof import('../client-cleanup-marker');
beforeEach(() => {
  jest.resetModules(); cookie = ''; written = ''; fault = '';
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { if (fault === 'generationRead') throw new Error('private'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (fault === 'generationWrite') throw new Error('private'); if (fault !== 'generationDrop') values.set(key, value); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    get cookie() { if (fault === 'read') throw new Error('private'); return cookie; },
    set cookie(value: string) {
      if (fault === 'write') throw new Error('private'); written = value;
      if (fault === 'drop') return;
      cookie = value.includes('Max-Age=0;') ? '' : value.split(';')[0];
    },
  } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:' } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  marker = require('../client-cleanup-marker');
});
afterEach(() => {
  for (const [key, descriptor] of [['document', originalDocument], ['location', originalLocation], ['window', originalWindow], ['localStorage', originalStorage]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
test('normal guest and unrelated cookie values do not imply cleanup; only the exact fixed marker does', () => {
  expect(marker.hasClientCleanupNeeded()).toBe(false);
  cookie = 'other=1; carelink_client_cleanup=10; xcarelink_client_cleanup=1'; expect(marker.hasClientCleanupNeeded()).toBe(false);
  cookie = 'other=1; carelink_client_cleanup=1'; expect(marker.hasClientCleanupNeeded()).toBe(true);
});
test('SSR reads no browser state and cannot claim a marker write', () => {
  Reflect.deleteProperty(globalThis, 'document'); expect(marker.hasClientCleanupNeeded()).toBe(false);
  expect(() => marker.markClientCleanupNeeded()).toThrow(/確認情報を更新できません/);
  expect(marker.hasClientCleanupNeeded()).toBe(true);
});
test.each(['http:', 'https:'])('marker contains only a fixed flag and seven-day cookie attributes on %s', protocol => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol } });
  marker.markClientCleanupNeeded(); expect(marker.hasClientCleanupNeeded()).toBe(true);
  expect(written).toBe(`carelink_client_cleanup=1; Path=/; Max-Age=604800; SameSite=Lax${protocol === 'https:' ? '; Secure' : ''}`);
  expect(written).not.toMatch(/user|email|token|receipt/i);
  marker.completeClientCleanupMarker(); expect(marker.hasClientCleanupNeeded()).toBe(false);
});
test('absence of a location still permits a nonsecure controlled cookie write', () => {
  Reflect.deleteProperty(globalThis, 'location'); marker.markClientCleanupNeeded(); expect(written).not.toContain('Secure');
});
test.each(['write', 'drop', 'read'])('failed marker %s is visible and leaves a memory fence until verified cleanup', kind => {
  fault = kind; expect(() => marker.markClientCleanupNeeded()).toThrow(/確認情報を更新できません/);
  expect(marker.hasClientCleanupNeeded()).toBe(true);
  fault = ''; marker.markClientCleanupNeeded(); marker.completeClientCleanupMarker(); expect(marker.hasClientCleanupNeeded()).toBe(false);
});
test('cookie reads that fail without a prior local mark fail closed', () => { fault = 'read'; expect(marker.hasClientCleanupNeeded()).toBe(true); });
test.each(['drop', 'write', 'read'])('failed marker clear (%s) retains the fence and can be retried', kind => {
  marker.markClientCleanupNeeded(); fault = kind;
  expect(() => marker.completeClientCleanupMarker()).toThrow(/確認情報を更新できません/);
  expect(marker.hasClientCleanupNeeded()).toBe(true);
  fault = ''; marker.completeClientCleanupMarker(); expect(marker.hasClientCleanupNeeded()).toBe(false);
});
test('verified marker removal notifies mounted draft controls without carrying personal input', () => {
  const dispatchEvent = jest.fn(); Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent } });
  marker.markClientCleanupNeeded(); marker.completeClientCleanupMarker();
  expect(dispatchEvent).toHaveBeenCalledTimes(1); expect(dispatchEvent.mock.calls[0][0].type).toBe(marker.CLIENT_CLEANUP_COMPLETED_EVENT);
});
test('a verified cleanup records only a non-secret generation before removing its cookie', () => {
  expect(marker.getClientCleanupGeneration()).toBeNull(); marker.markClientCleanupNeeded(); marker.completeClientCleanupMarker();
  const first = marker.getClientCleanupGeneration(); expect(first).toMatch(/^[a-f0-9-]{36}$/);
  expect([...values.keys()]).toEqual([marker.CLIENT_CLEANUP_GENERATION_KEY]);
  expect(JSON.stringify([...values.values()])).not.toMatch(/email|name|token|identity|receipt/);
  marker.completeClientCleanupMarker(); expect(marker.getClientCleanupGeneration()).toBe(first);
  marker.markClientCleanupNeeded(); marker.completeClientCleanupMarker(); expect(marker.getClientCleanupGeneration()).not.toBe(first);
});
test.each(['generationRead', 'generationWrite', 'generationDrop'])('generation %s failure retains the cleanup fence until readback succeeds', kind => {
  marker.markClientCleanupNeeded(); fault = kind;
  expect(() => marker.completeClientCleanupMarker()).toThrow(/確認情報を更新できません/); expect(cookie).toContain('carelink_client_cleanup=1');
  expect(marker.hasClientCleanupNeeded()).toBe(true); fault = ''; marker.completeClientCleanupMarker(); expect(marker.hasClientCleanupNeeded()).toBe(false);
});
test('corrupt generation state never restores as legacy, but a verified wipe can establish a new valid generation', () => {
  values.set(marker.CLIENT_CLEANUP_GENERATION_KEY, 'unknown'); expect(() => marker.getClientCleanupGeneration()).toThrow(/確認情報を更新できません/);
  marker.markClientCleanupNeeded(); marker.completeClientCleanupMarker();
  expect(marker.hasClientCleanupNeeded()).toBe(false); expect(marker.getClientCleanupGeneration()).toMatch(/^[a-f0-9-]{36}$/);
});
test('deletion preflight persists a shared generation without releasing the cookie, even when no response arrives', () => {
  marker.prepareClientCleanupMarker();
  const generation = marker.getClientCleanupGeneration();
  expect(generation).toMatch(/^[a-f0-9-]{36}$/);
  expect(cookie).toBe('carelink_client_cleanup=1');
  // Another tab has no knowledge of the initiating tab's in-memory flag.
  jest.resetModules();
  const otherTab: typeof marker = require('../client-cleanup-marker');
  expect(otherTab.hasClientCleanupNeeded()).toBe(true);
  expect(otherTab.getClientCleanupGeneration()).toBe(generation);
  otherTab.completeClientCleanupMarker();
  expect(cookie).toBe('');
  expect(otherTab.getClientCleanupGeneration()).not.toBe(generation);
});
test.each(['write', 'drop', 'read', 'generationRead', 'generationWrite', 'generationDrop'])('deletion preflight %s failure cannot claim shared-fence readiness', kind => {
  fault = kind;
  expect(() => marker.prepareClientCleanupMarker()).toThrow(/確認情報を更新できません/);
  expect(marker.hasClientCleanupNeeded()).toBe(true);
});
