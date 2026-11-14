import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
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
  // Next の出力形式が変わって置換が空振りすると、全モジュールの事前読み込みが行われないまま
  // /privacy の 200 だけで成功扱いになっていた。置換対象が無ければ止める。
  const PRELOAD_OFF = '"preloadEntriesOnStart":false';
  if (!source.includes(PRELOAD_OFF)) throw new Error(`server.js does not contain ${PRELOAD_OFF}; cannot enable module preloading`);
  await writeFile(warmEntry, source
    .replace(PRELOAD_OFF, '"preloadEntriesOnStart":true')
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
  let forceKilled = false;
  let ready = false;
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
        // Headers may arrive while route modules are still compiling. A body
        // timeout is the same bounded readiness retry as a connection timeout.
        await response.arrayBuffer();
      } catch {
        await new Promise((done) => setTimeout(done, 50));
        continue;
      }
      if (response.status !== 200) throw new Error('Compile-cache warmup page did not return HTTP 200');
      ready = true;
      break;
    }
    if (!ready) throw new Error('Compile-cache warmup exceeded its readiness deadline');
  } finally {
    // A graceful exit flushes Node's accumulated module bytecode to disk.
    if (!exited) {
      const timer = setTimeout(() => { forceKilled = true; child.kill('SIGKILL'); }, shutdownMs);
      child.kill('SIGTERM');
      await exit;
      clearTimeout(timer);
    }
    await rm(warmEntry, { force: true });
  }
  // SIGKILL ではバイトコードが書き出されない。成功扱いにせず、キャッシュの実在も確かめる。
  if (forceKilled) throw new Error('Compile-cache warmup server did not exit gracefully; bytecode cache was not flushed');
  const written = (await readdir(cacheDir, { recursive: true })).filter((name) => !name.startsWith('.compile-cache-warmup-'));
  if (written.length === 0) throw new Error('Compile-cache warmup produced no cache files');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await warmRuntimeCompileCache();
  console.log('Runtime module compile cache prepared');
}
