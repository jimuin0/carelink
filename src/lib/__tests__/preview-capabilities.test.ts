/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { isPublicReadOnlyPreview } from '../preview-capabilities';

const original = process.env;
afterEach(() => { process.env = original; });

test.each([
  ['preview', undefined, true],
  ['preview', 'isolated-preview-key', false],
  ['production', undefined, false],
  ['development', undefined, false],
  [undefined, undefined, false],
])('private capability is omitted only for unconfigured Preview (%s)', (environment, key, expected) => {
  process.env = { ...original };
  if (environment === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = environment;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  expect(isPublicReadOnlyPreview()).toBe(expected);
});
