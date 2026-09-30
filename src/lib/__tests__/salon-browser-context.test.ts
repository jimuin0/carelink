/** @jest-environment node */
import { readSalonBrowserContext, saveSalonBrowserContext, SALON_BROWSER_CONTEXT_KEY,
  SALON_ONBOARDING_PATH, SALON_COMPLETE_PATH, salonHandoffAuthPath } from '../salon-browser-context';
const intentId = '74000000-0000-4000-8000-000000000001';
const context = { version: 1 as const, intentId, phase: 'attempted' as const };
function store(value: string | null = null) {
  let stored = value;
  return { getItem: jest.fn(() => stored), setItem: jest.fn((_key: string, next: string) => { stored = next; }) };
}
test('empty browser state is distinct from unavailable/corrupt state', () => {
  expect(readSalonBrowserContext(store())).toEqual({ state: 'empty' });
  expect(readSalonBrowserContext(store('{'))).toEqual({ state: 'unavailable' });
});
test.each([{}, null, { ...context, version: 2 }, { ...context, intentId: 'bad' },
  { ...context, phase: 'success' }, { ...context, email: 'private@example.invalid' },
  { ...context, proof: 'synthetic-secret' }])('invalid or sensitive persistent state refuses reuse %#', value => {
  const storage = store(JSON.stringify(value));
  expect(readSalonBrowserContext(storage)).toEqual({ state: 'unavailable' });
  expect(saveSalonBrowserContext(storage, value as typeof context)).toBe(false);
  expect(storage.setItem).not.toHaveBeenCalled();
});
test.each(['prepared', 'attempted', 'confirmed'] as const)('only selector and %s phase round-trip', phase => {
  const storage = store();
  expect(saveSalonBrowserContext(storage, { ...context, phase })).toBe(true);
  expect(readSalonBrowserContext(storage)).toEqual({ state: 'ready', context: { ...context, phase } });
  expect(storage.setItem).toHaveBeenCalledWith(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ ...context, phase }));
});
test('read denial, quota exhaustion and non-durable write do not become empty/success', () => {
  const storage = store(); storage.getItem.mockImplementation(() => { throw new Error('blocked'); });
  expect(readSalonBrowserContext(storage)).toEqual({ state: 'unavailable' });
  expect(saveSalonBrowserContext(storage, context)).toBe(false);
  const quota = store(); quota.setItem.mockImplementation(() => { throw new Error('quota'); });
  expect(saveSalonBrowserContext(quota, context)).toBe(false);
  const lost = store(); lost.setItem.mockImplementation(() => {});
  expect(saveSalonBrowserContext(lost, context)).toBe(false);
});
test('two tabs retain independent application selections', () => {
  const a = store(), b = store();
  const other = { ...context, intentId: '74000000-0000-4000-8000-000000000002' };
  expect(saveSalonBrowserContext(a, context)).toBe(true); expect(saveSalonBrowserContext(b, other)).toBe(true);
  expect(readSalonBrowserContext(a)).toEqual({ state: 'ready', context });
  expect(readSalonBrowserContext(b)).toEqual({ state: 'ready', context: other });
});
test.each(['signup', 'login'] as const)('auth %s carries only a non-secret mode marker', page => {
  const url = new URL(salonHandoffAuthPath(page), 'https://synthetic.invalid');
  expect(url.pathname).toBe('/auth/' + page);
  expect(url.searchParams.get('redirect')).toBe(SALON_ONBOARDING_PATH);
  expect(SALON_ONBOARDING_PATH).toBe('/admin/onboarding?handoff=registration');
  expect(SALON_COMPLETE_PATH).toBe('/register/complete?handoff=registration');
  expect(url.href).not.toContain(intentId);
});
