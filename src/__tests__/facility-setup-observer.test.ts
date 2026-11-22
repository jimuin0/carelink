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
    fulfill: jest.fn(async () => undefined), abort: jest.fn(async () => undefined), continue: jest.fn(async () => undefined),
    fallback: jest.fn(async () => undefined) };
  return { run: (submit: () => Promise<void>) => exported.observeFacilitySetup!(page, submit), page, body, response,
    route, deliver: () => handler(route), handler: () => handler };
}

// Chromium strands requests in flight when the last route is removed during a navigation, so the
// observer must never unroute. Once settled it must hand every request on untouched instead.
async function expectInertWithoutUnroute(f: ReturnType<typeof fixture>) {
  expect(f.page.unroute).not.toHaveBeenCalled();
  for (const method of ['POST', 'GET']) {
    const later = { request: () => ({ method: () => method }), fallback: jest.fn(async () => undefined),
      fetch: jest.fn(), fulfill: jest.fn(), abort: jest.fn(), continue: jest.fn() };
    await f.handler()(later);
    expect(later.fallback).toHaveBeenCalledTimes(1);
    for (const touched of [later.fetch, later.fulfill, later.abort, later.continue]) expect(touched).not.toHaveBeenCalled();
  }
}

test('one real response is inspected and fulfilled without changing status/body', async () => {
  const f = fixture();
  expect(await f.run(f.deliver)).toEqual({ status: 201, body: f.body });
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
  expect(f.route.fetch).toHaveBeenCalledWith({ maxRetries: 0 });
  expect(f.route.fulfill).toHaveBeenCalledWith({ response: f.response });
  expect(f.route.abort).not.toHaveBeenCalled();
  await expectInertWithoutUnroute(f);
});
test.each(['fetch', 'json', 'fulfill'] as const)('upstream %s failure is not a synthetic success or resend', async phase => {
  const f = fixture(); const failure = new Error(`synthetic ${phase} failure`);
  if (phase === 'json') f.response.json.mockRejectedValueOnce(failure);
  else f.route[phase].mockRejectedValueOnce(failure);
  await expect(f.run(f.deliver)).rejects.toBe(failure);
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
  expect(f.route.abort).toHaveBeenCalledWith('connectionfailed');
  await expectInertWithoutUnroute(f);
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
  await expectInertWithoutUnroute(missing);
  const duplicate = fixture();
  await expect(duplicate.run(async () => { await duplicate.deliver(); await duplicate.deliver(); })).rejects.toThrow();
  expect(duplicate.route.fetch).toHaveBeenCalledTimes(2);
  await expectInertWithoutUnroute(duplicate);
});
test('submission failure leaves the installed observer inert', async () => {
  const f = fixture(); const failure = new Error('synthetic click failure');
  await expect(f.run(async () => { throw failure; })).rejects.toBe(failure);
  expect(f.route.fetch).not.toHaveBeenCalled();
  await expectInertWithoutUnroute(f);
});
test('non-POST traffic continues unchanged and does not count as setup', async () => {
  const f = fixture();
  const other = { ...f.route, request: () => ({ method: () => 'GET' }) };
  expect(await f.run(async () => { await f.handler()(other); await f.deliver(); }))
    .toEqual({ status: 201, body: f.body });
  expect(f.route.continue).toHaveBeenCalledTimes(1);
  expect(f.route.fetch).toHaveBeenCalledTimes(1);
});
