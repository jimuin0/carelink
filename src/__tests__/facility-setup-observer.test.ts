/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(join(process.cwd(), 'e2e/facility-setup-observer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const exported: { observeFacilitySetup?: (page: unknown, submit: () => Promise<void>) => Promise<unknown> } = {};
  // Immediate polling makes unobserved failures deterministic and keeps this
  // module-contract test offline. Real Playwright polling is covered by CI E2E.
  const observationExpect = Object.assign((value: unknown) => expect(value), {
    poll: (read: () => unknown) => ({ toBe: async (value: unknown) => expect(read()).toBe(value) }),
  });
  runInNewContext(compiled, { exports: exported, require: (name: string) => {
    if (name === '@playwright/test') return { expect: observationExpect };
    throw new Error('unexpected observer import');
  } });
  let handler!: (route: unknown) => Promise<void>;
  const page = { route: jest.fn(async (_pattern: string, callback: typeof handler) => { handler = callback; }),
    unroute: jest.fn(async () => undefined) };
  const body = { success: true, state: 'created', facilityId: 'synthetic', slug: 'synthetic' };
  const response = { status: () => 201, json: jest.fn(async () => body) };
  const route = { request: () => ({ method: () => 'POST' }), fetch: jest.fn(async () => response),
    fulfill: jest.fn(async () => undefined), abort: jest.fn(async () => undefined), continue: jest.fn(async () => undefined) };
  return { run: (submit: () => Promise<void>) => exported.observeFacilitySetup!(page, submit), page, body, response,
    route, deliver: () => handler(route), handler: () => handler };
}

test('one real response is inspected and fulfilled without changing status/body', async () => {
  const f = fixture();
  expect(await f.run(f.deliver)).toEqual({ status: 201, body: f.body });
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
  expect(f.route.fetch).toHaveBeenCalledWith({ maxRetries: 0 });
  expect(f.route.fulfill).toHaveBeenCalledWith({ response: f.response });
  expect(f.route.abort).not.toHaveBeenCalled();
  expect(f.page.unroute).toHaveBeenCalledWith('**/api/facility/setup', f.handler());
});
test.each(['fetch', 'json', 'fulfill'] as const)('upstream %s failure is not a synthetic success or resend', async phase => {
  const f = fixture(); const failure = new Error(`synthetic ${phase} failure`);
  if (phase === 'json') f.response.json.mockRejectedValueOnce(failure);
  else f.route[phase].mockRejectedValueOnce(failure);
  await expect(f.run(f.deliver)).rejects.toBe(failure);
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
  expect(f.route.abort).toHaveBeenCalledWith('connectionfailed');
  expect(f.page.unroute).toHaveBeenCalledWith('**/api/facility/setup', f.handler());
});
test('an observed non-success status is preserved for the caller to reject', async () => {
  const f = fixture(); f.response.status = () => 500;
  expect(await f.run(f.deliver)).toEqual({ status: 500, body: f.body });
  expect(f.route.fulfill).toHaveBeenCalledWith({ response: f.response });
});
test('no response and duplicated posts cannot pass the observation contract', async () => {
  const missing = fixture();
  await expect(missing.run(async () => undefined)).rejects.toThrow();
  expect(missing.route.fetch).not.toHaveBeenCalled();
  expect(missing.page.unroute).toHaveBeenCalled();
  const duplicate = fixture();
  await expect(duplicate.run(async () => { await duplicate.deliver(); await duplicate.deliver(); })).rejects.toThrow();
  expect(duplicate.route.fetch).toHaveBeenCalledTimes(2);
  expect(duplicate.page.unroute).toHaveBeenCalled();
});
test('submission failure removes only the installed observer', async () => {
  const f = fixture(); const failure = new Error('synthetic click failure');
  await expect(f.run(async () => { throw failure; })).rejects.toBe(failure);
  expect(f.route.fetch).not.toHaveBeenCalled();
  expect(f.page.unroute).toHaveBeenCalledWith('**/api/facility/setup', f.handler());
});
test('non-POST traffic continues unchanged and does not count as setup', async () => {
  const f = fixture();
  const other = { ...f.route, request: () => ({ method: () => 'GET' }) };
  expect(await f.run(async () => { await f.handler()(other); await f.deliver(); }))
    .toEqual({ status: 201, body: f.body });
  expect(f.route.continue).toHaveBeenCalledTimes(1);
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
});
