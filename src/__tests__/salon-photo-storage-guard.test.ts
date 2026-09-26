/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { businessTypes } from '../lib/constants';

const source = readFileSync(join(process.cwd(), 'e2e/salon-photo-storage.spec.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const approved = {
  GITHUB_ACTIONS: 'true', CI: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330',
  PLAYWRIGHT_BASE_URL: 'https://localhost:3000', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
};

function fixture(env: Record<string, string>) {
  let setup!: () => Promise<void>;
  const createUser = jest.fn().mockResolvedValue({ data: { user: { id: 'synthetic' } }, error: null });
  const signInWithPassword = jest.fn().mockResolvedValue({ data: { session: {} }, error: null });
  const createClient = jest.fn().mockReturnValue({ auth: { admin: { createUser }, signInWithPassword } });
  const use = jest.fn();
  const test = Object.assign(jest.fn(), { use, beforeAll: (callback: typeof setup) => { setup = callback; } });
  // Browser tests are registered, never run. No socket/fetch/process capability
  // is supplied; even the positive guard control cannot perform real I/O.
  const exported: { reject?: (error: unknown, operation: string) => void;
    duplicate?: (error: unknown) => void; token?: (value: unknown) => boolean } = {};
  runInNewContext(`${compiled}\nexports.reject = expectServiceRejection; exports.duplicate = expectDuplicate; exports.token = isUploadToken;`, {
    exports: exported, Buffer, process: { env },
    require: (name: string) => {
      if (name === '@playwright/test') return { test, expect: (value: unknown) => expect(value) };
      if (name === '@supabase/supabase-js') return { createClient };
      if (name === 'node:crypto') return { randomUUID: () => 'synthetic-id' };
      if (name === '../src/lib/constants') return { businessTypes };
      throw new Error('unexpected fixture import');
    },
  });
  return { setup, use, createClient, createUser, signInWithPassword, reject: exported.reject!, duplicate: exported.duplicate!, token: exported.token! };
}

test('capability-bearing suite overrides retry trace and media capture before any I/O', () => {
  const { use, createClient } = fixture(approved);
  expect(use).toHaveBeenCalledTimes(1);
  expect(use).toHaveBeenCalledWith({ trace: 'off', screenshot: 'off', video: 'off' });
  expect(createClient).not.toHaveBeenCalled();
});

test.each([
  { CI: '' }, { GITHUB_ACTIONS: '' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }, { PLAYWRIGHT_BASE_URL: 'https://production.invalid' },
  { SUPABASE_SERVICE_ROLE_KEY: '' }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
])('photo storage test rejects unapproved execution before creating clients %#', async overrides => {
  const { setup, createClient } = fixture({ ...approved, ...overrides });
  await expect(setup()).rejects.toThrow('photo storage contracts require the managed disposable HTTPS CI lifecycle');
  expect(createClient).not.toHaveBeenCalled();
});

test('approved positive control reaches only substituted synthetic identity setup', async () => {
  const { setup, createClient, createUser, signInWithPassword } = fixture(approved);
  await setup();
  expect(createClient).toHaveBeenCalledTimes(3);
  expect(createUser).toHaveBeenCalledWith({ email: 'photo-contract-synthetic-id@example.invalid', password: 'synthetic-id', email_confirm: true });
  expect(signInWithPassword).toHaveBeenCalledTimes(1);
});

test.each([
  null, { name: 'StorageUnknownError' },
  { name: 'StorageApiError', status: 500, statusCode: 'InternalError' },
  { name: 'StorageApiError', status: 401, statusCode: 'InvalidJWT' },
  { name: 'StorageApiError', status: 404, statusCode: 'NotFound' },
  { name: 'StorageApiError', status: 429, statusCode: 'TooManyRequests' },
  { name: 'StorageApiError', status: 403, statusCode: '' },
])('network/infra/auth failure cannot masquerade as a Storage rejection %#', failure => {
  expect(() => fixture(approved).reject(failure, 'synthetic operation')).toThrow();
});

test('a classified Storage API denial passes the rejection control', () => {
  expect(() => fixture(approved).reject({ name: 'StorageApiError', status: 403, statusCode: 'AccessDenied' }, 'synthetic operation')).not.toThrow();
});

test.each([
  null, { name: 'StorageApiError', status: 400, statusCode: 'InvalidJWT', message: 'Invalid token' },
  { name: 'StorageApiError', status: 403, statusCode: '403', message: 'Access denied' },
  { name: 'StorageApiError', status: 503, statusCode: '409', message: 'The resource already exists' },
  { name: 'StorageApiError', status: 409, statusCode: '409', message: 'Unrelated conflict' },
])('non-duplicate errors cannot prove valid-token immutability %#', error => {
  expect(() => fixture(approved).duplicate(error)).toThrow();
});
test.each([400, 409])('only explicit object duplicate passes HTTP %s', status => {
  expect(() => fixture(approved).duplicate({ name: 'StorageApiError', status, statusCode: '409', message: 'The resource already exists' })).not.toThrow();
});
test.each([undefined, '', 'token', 'a.b', 'a.b.c.d', 'a.b.='])('malformed token is rejected without printing its value %#', value => {
  expect(fixture(approved).token(value)).toBe(false);
});
test('synthetic token shape positive control', () => {
  expect(fixture(approved).token('a.b.c')).toBe(true);
});
