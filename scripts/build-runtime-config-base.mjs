import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const NODE_BASE = 'node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
const REGISTRY_PATH = 'vcr.vercel.com/jimuin/carelink/node24-public-config';
const PUBLIC_KEYS = [
  'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_CLARITY_ID',
  'NEXT_PUBLIC_GA_ID', 'NEXT_PUBLIC_GSC_VERIFICATION_APEX', 'NEXT_PUBLIC_LIFF_ID',
  'NEXT_PUBLIC_LINE_CHANNEL_ID', 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY',
  'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
];

/** Only settings already intended for the browser can enter this base image. */
export function publicSettings(env) {
  const selected = Object.fromEntries(PUBLIC_KEYS
    .filter((key) => typeof env[key] === 'string' && env[key].length > 0)
    .map((key) => [key, env[key].trim()])
    .filter(([, value]) => value.length > 0));
  // Pasted values may carry an outer newline. Normalize it before Dockerfile
  // quoting, which would otherwise turn the escape into literal token bytes.
  if (Object.values(selected).some((value) => /[\r\n\0]/.test(value))) {
    throw new Error('Public settings must be single-line values');
  }
  const url = new URL(selected.NEXT_PUBLIC_SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('A public HTTPS Supabase origin is required');
  }
  const key = selected.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (typeof key !== 'string') throw new Error('A public Supabase key is required');
  if (key.startsWith('eyJ')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Refusing a malformed public key'); }
    if (claims.role !== 'anon') throw new Error('Refusing a privileged Supabase key');
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Refusing an unrecognized public key format');
  }
  return selected;
}

export function configDockerfile(settings) {
  // No RUN or COPY: this image contains only the official Node binary and
  // browser configuration. Dockerfile interpolation cannot expand a value.
  return `FROM ${NODE_BASE}\n` + Object.entries(settings)
    .map(([key, value]) => `ENV ${key}=${JSON.stringify(value).replaceAll('$', '\\$')}\n`)
    .join('');
}

export function validateTag(tag) {
  if (!tag.startsWith(`${REGISTRY_PATH}:`) ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag.slice(REGISTRY_PATH.length + 1))) {
    throw new Error('Use a versioned tag in the existing CareLink project registry');
  }
  return tag;
}

export function main(args = process.argv.slice(2), env = process.env, run = spawnSync) {
  const tag = validateTag(args[0] ?? '');
  const selected = publicSettings(env);
  const childEnv = Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']
    .filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  const invoke = (command, input) => {
    const result = run('docker', command, { input, encoding: 'utf8',
      env: childEnv, timeout: 1_200_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      // Never print raw build output: a failed Dockerfile parse can echo ENV.
      throw new Error('Configuration image operation failed; no values were logged');
    }
    return result.stdout;
  };
  invoke(['build', '--platform', 'linux/amd64', '--quiet', '-t', tag, '-'],
    configDockerfile(selected));
  invoke(['push', tag]);
  const images = JSON.parse(invoke(['image', 'inspect', tag]));
  const image = images[0].RepoDigests.find((ref) => ref.startsWith(`${REGISTRY_PATH}@sha256:`) &&
    /@sha256:[a-f0-9]{64}$/.test(ref));
  if (!image || images[0].Architecture !== 'amd64') throw new Error('Missing amd64 digest');
  return { image, nodeVersion: '24.22.1', publicSettingNames: Object.keys(selected),
    privateServerSettingsIncluded: false, applicationCodeIncluded: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(main(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
