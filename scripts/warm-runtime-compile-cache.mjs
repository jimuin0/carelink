import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Run only while building the image, without runtime secrets. /privacy is a
// public, read-only page and loads the shared Next/React rendering modules.
// This stores bytecode, not responses, sessions, or a V8 heap snapshot.
export async function warmRuntimeCompileCache({
  cwd = process.cwd(),
  port = 3000,
  timeoutMs = 30_000,
  shutdownMs = 5_000,
} = {}) {
  // Preload all modules only during the secret-free image build. Keep the
  // deployed launcher unchanged so cold starts load routes on demand.
  const cacheDir = resolve(cwd, '.node-compile-cache');
  await mkdir(cacheDir, { recursive: true });
  // Only this directory is writable by the runtime user in the final image.
  const warmEntry = resolve(cacheDir, `.compile-cache-warmup-${randomUUID()}.cjs`);
  const source = await readFile(resolve(cwd, 'server.js'), 'utf8');
  await writeFile(warmEntry, source
    .replace('"preloadEntriesOnStart":false', '"preloadEntriesOnStart":true')
    .replaceAll('__dirname', 'require("node:path").resolve(__dirname, "..")'));
  const child = spawn(process.execPath, [warmEntry], {
    cwd,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_COMPILE_CACHE: cacheDir,
      NODE_COMPILE_CACHE_PORTABLE: '1',
    },
    // Do not copy application output into build diagnostics.
    stdio: 'ignore',
  });
  let exited = false;
  const exit = new Promise((done) => {
    child.once('exit', () => { exited = true; done(); });
    child.once('error', () => { exited = true; done(); });
  });
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exited) throw new Error('Compile-cache warmup server exited before readiness');
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${port}/privacy`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.min(1_000, deadline - Date.now())),
        });
      } catch {
        await new Promise((done) => setTimeout(done, 50));
        continue;
      }
      await response.arrayBuffer();
      if (response.status !== 200) throw new Error('Compile-cache warmup page did not return HTTP 200');
      return;
    }
    throw new Error('Compile-cache warmup exceeded its readiness deadline');
  } finally {
    // A graceful exit flushes Node's accumulated module bytecode to disk.
    if (!exited) {
      const timer = setTimeout(() => child.kill('SIGKILL'), shutdownMs);
      child.kill('SIGTERM');
      await exit;
      clearTimeout(timer);
    }
    await rm(warmEntry, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await warmRuntimeCompileCache();
  console.log('Runtime module compile cache prepared');
}
