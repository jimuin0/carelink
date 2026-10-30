import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(file, args, env = process.env) {
  const result = spawnSync(process.execPath, [resolve(file), ...args], { env, stdio: 'inherit' });
  return result.status ?? 1;
}

const prepared = run('tools/cloudflare/prepare-og-assets.mjs', []);
if (prepared !== 0) process.exit(prepared);
const built = run('node_modules/vite/bin/vite.js', ['build'], { ...process.env, CARELINK_CLOUDFLARE_BUILD: '1' });
// vinext generates .next/types/routes.d.ts and next-env.d.ts with its own
// incompatible declarations. Restore the Next.js generated types even after
// a failed Worker build so the regular application typecheck remains valid.
const restored = run('node_modules/next/dist/bin/next', ['typegen', '--webpack']);
if (built !== 0 || restored !== 0) process.exit(built || restored);
