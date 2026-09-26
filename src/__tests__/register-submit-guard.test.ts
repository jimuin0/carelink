/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(readFileSync(join(process.cwd(), 'e2e/register-submit.spec.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const approved = { GITHUB_ACTIONS: 'true', CI: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330',
  PLAYWRIGHT_BASE_URL: 'https://localhost:3000', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SALON_REGISTRATION_V2_ENABLED: 'true' };
function fixture(env: Record<string, string>) {
  let setup!: () => void;
  const createClient = jest.fn(); const use = jest.fn();
  const test = Object.assign(jest.fn(), { use, beforeAll: (callback: typeof setup) => { setup = callback; },
    describe: (_title: string, callback: () => void) => callback() });
  runInNewContext(compiled, { exports: {}, process: { env }, URL,
    require: (name: string) => {
      if (name === '@playwright/test') return { test, expect };
      if (name === '@supabase/supabase-js') return { createClient };
      if (name === 'node:crypto') return { randomUUID: () => 'synthetic' };
      throw new Error('unexpected fixture import');
    },
  });
  return { setup, use, createClient };
}
test('synthetic registration capabilities are not persisted as trace or media', () => {
  const { setup, use, createClient } = fixture(approved);
  expect(use).toHaveBeenCalledWith({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
  expect(() => setup()).not.toThrow(); expect(createClient).not.toHaveBeenCalled();
});
test.each([{ CI: '' }, { GITHUB_ACTIONS: '' }, { SALON_REGISTRATION_V2_ENABLED: '' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' }, { PLAYWRIGHT_BASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }, { SUPABASE_SERVICE_ROLE_KEY: '' }])('unapproved registration E2E fails before any I/O %#', overrides => {
  const { setup, createClient } = fixture({ ...approved, ...overrides });
  expect(() => setup()).toThrow(); expect(createClient).not.toHaveBeenCalled();
});
