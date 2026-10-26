import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingPackage = JSON.parse(readFileSync(path.join(root, 'cloudflare/package.json'), 'utf8'));
const currentHash = createHash('sha256').update(readFileSync(path.join(root, 'package.json'))).digest('hex');
if (currentHash !== stagingPackage.carelinkSource.packageSha256) {
  throw new Error('Application dependencies changed. Review and refresh the separate Cloudflare lockfile first.');
}

// A fresh source-only workspace prevents loading production .env files, browser
// sessions, credentials, reports, or a different checkout's node_modules.
const parent = path.join(root, 'work/cloudflare-staging');
mkdirSync(parent, { recursive: true });
const workspace = mkdtempSync(path.join(parent, 'app-'));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
function copy(relative, destination = relative) {
  const target = path.join(workspace, destination);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, relative), target);
}
for (const file of tracked) {
  // Include public repository contracts/docs as well: existing tests inspect CI
  // and deployment configuration. Exclude every env file and local artifact.
  if (file.split('/').some(part => part.startsWith('.env'))
    || ['work', 'node_modules', '.vercel', '.cloudflare'].includes(file.split('/')[0])) continue;
  copy(file);
}
for (const name of ['package.json', 'package-lock.json', 'vite.config.mts']) {
  copy(`cloudflare/${name}`, name);
}
copy('cloudflare/cloudflare.config.mts', 'cloudflare.config.ts');
for (const name of ['og-assets.mjs', 'staging-worker.mjs', 'staging-handler.mjs', 'staging-env.mjs']) copy(`cloudflare/${name}`, `cloudflare/${name}`);
copy('cloudflare/start-ci-https.mjs', 'scripts/start-ci-https.mjs');
writeFileSync(path.join(parent, 'current.json'), JSON.stringify({
  workspace, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  productionEnvironmentCopied: false,
}, null, 2) + '\n');
console.log(workspace);
