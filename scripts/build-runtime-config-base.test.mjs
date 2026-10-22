import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSettings, configDockerfile, validateTag, main } from './build-runtime-config-base.mjs';

const tag = 'vcr.vercel.com/jimuin/carelink/node24-public-config:test';
const jwt = (role) => 'eyJ0ZXN0Ijp0cnVlfQ.' +
  Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'), PATH: '/test',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service', RESEND_API_KEY: 'private-email',
  NEXT_PUBLIC_UNAPPROVED: 'unapproved-value' };

test('allowlist excludes server secrets and unknown public names', () => {
  const settings = publicSettings(env);
  assert.deepEqual(Object.keys(settings).sort(),
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
  assert.ok(!JSON.stringify(settings).includes('private-'));
});
test('privileged, missing, malformed keys and credential-bearing origins are rejected', () => {
  for (const key of [jwt('service_role'), 'sb_secret_test', undefined, 'eyJ.invalid.test']) {
    assert.throws(() => publicSettings({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: key }));
  }
  for (const url of ['http://example.test', 'https://user:pass@example.test', undefined]) {
    assert.throws(() => publicSettings({ ...env, NEXT_PUBLIC_SUPABASE_URL: url }));
  }
  assert.equal(publicSettings({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test' })
    .NEXT_PUBLIC_SUPABASE_ANON_KEY, 'sb_publishable_test');
});
test('only a versioned tag in this project can receive the image', () => {
  assert.equal(validateTag(tag), tag);
  for (const value of ['', 'docker.io/other/image:test', tag + ' bad', tag.replace(':test', '')]) {
    assert.throws(() => validateTag(value));
  }
});
test('Dockerfile contains no app code, RUN, or private values and escapes interpolation', () => {
  const text = configDockerfile({ ...publicSettings(env), NEXT_PUBLIC_SITE_URL: 'https://example.test/$value' });
  assert.ok(text.startsWith('FROM node:24.22.1-bookworm-slim@sha256:'));
  assert.ok(!/^(RUN|COPY) /m.test(text));
  assert.ok(text.includes('\\$value'));
  assert.ok(!text.includes('private-'));
});
test('build receives config on stdin; child environment and errors do not expose secrets', () => {
  const calls = [];
  const run = (program, args, options) => {
    calls.push({ program, args, options });
    return { status: 0, stdout: args[0] === 'image' ? JSON.stringify([{ Architecture: 'amd64',
      RepoDigests: ['vcr.vercel.com/jimuin/carelink/node24-public-config@sha256:' + 'a'.repeat(64)] }]) : '' };
  };
  const result = main([tag], env, run);
  assert.equal(result.privateServerSettingsIncluded, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].program, 'docker');
  assert.ok(calls[0].options.input.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
  assert.ok(calls.every((call) => !JSON.stringify(call.options.env).includes('private-')));
  assert.throws(() => main([tag], env, () => ({ status: 1, stderr: 'private-error' })),
    /no values were logged/);
});
