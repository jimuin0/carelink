// One disposable lifecycle: TLS dependency -> production build -> Playwright.
// No application code, cookie security or browser mixed-content policy is bypassed.
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createLocalCertificate } from './ci-test-tls.mjs';

let child;
let cancelled = false;
let phase = 'environment';
let killTimer;
const signalGroup = (pid, signal) => {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch { /* Already exited; no raw error output. */ }
};
const stop = () => {
  cancelled = true;
  const pid = child?.pid;
  signalGroup(pid, 'SIGTERM');
  killTimer = setTimeout(() => signalGroup(pid, 'SIGKILL'), 5000);
  killTimer.unref();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function run(args, env) {
  if (cancelled) throw new Error('cancelled');
  await new Promise((resolve, reject) => {
    // Async is essential: this process must continue servicing TLS requests.
    child = spawn('npm', args, { env, stdio: 'inherit', detached: true });
    child.once('error', reject);
    child.once('exit', async code => {
      const pid = child.pid;
      child = undefined;
      clearTimeout(killTimer);
      signalGroup(pid, 'SIGTERM');
      // Own process group only; bounded cleanup also covers npm descendants.
      for (let attempt = 0; attempt < 25; attempt += 1) {
        try { process.kill(-pid, 0); } catch { break; }
        await new Promise(done => setTimeout(done, 200));
      }
      signalGroup(pid, 'SIGKILL');
      if (code === 0 && !cancelled) resolve();
      else reject(new Error('child failed'));
    });
  });
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
    || !process.env.RUNNER_TEMP || !isAbsolute(process.env.RUNNER_TEMP)
    || ['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(file))) {
    console.error('Isolated TLS dependency environment refused before startup.');
    process.exitCode = 1;
    return;
  }
  phase = 'certificate';
  const tls = createLocalCertificate();
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP, 'carelink-public-ca-'));
  const caPath = join(directory, 'certificate.pem');
  let server;
  const upgradedSockets = new Set();
  try {
    // Only the PUBLIC certificate is persisted. Node reads extra CAs at startup.
    writeFileSync(caPath, tls.cert, { mode: 0o600, flag: 'wx' });
    const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330',
      NODE_EXTRA_CA_CERTS: caPath, ADMIN_COOKIE_SECRET: randomBytes(32).toString('hex') };
    phase = 'dependency-proxy';
    server = createServer(tls, (request, response) => {
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
        response.writeHead(400).end();
        return;
      }
      // Fixed destination, no user-supplied host, redirect following or logging.
      const upstream = httpRequest({ hostname: '127.0.0.1', port: 54321,
        method: request.method, path: request.url,
        headers: { ...request.headers, host: '127.0.0.1:54321', connection: 'close' },
      }, result => {
        response.writeHead(result.statusCode || 502, result.headers);
        result.on('error', () => response.destroy());
        result.pipe(response);
      });
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
    });
    server.on('upgrade', (request, socket, head) => {
      upgradedSockets.add(socket);
      socket.on('error', () => socket.destroy());
      socket.on('close', () => upgradedSockets.delete(socket));
      if (!request.url?.startsWith('/realtime/v1/') || request.headers.upgrade?.toLowerCase() !== 'websocket') {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: 54321,
        method: 'GET', path: request.url,
        headers: { ...request.headers, host: '127.0.0.1:54321' },
      });
      const timer = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 30000);
      upstream.on('upgrade', (result, peer, upstreamHead) => {
        clearTimeout(timer);
        upgradedSockets.add(peer);
        peer.on('close', () => upgradedSockets.delete(peer));
        if (socket.destroyed) { peer.destroy(); return; }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${result.rawHeaders.reduce((text, value, index, values) =>
          index % 2 === 0 ? `${text}${value}: ${values[index + 1]}\r\n` : text, '')}\r\n`);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) peer.write(head);
        socket.on('error', () => peer.destroy());
        peer.on('error', () => socket.destroy());
        socket.on('close', () => peer.destroy());
        peer.on('close', () => socket.destroy());
        socket.pipe(peer).pipe(socket);
      });
      upstream.on('response', result => { result.resume(); socket.destroy(); });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => { clearTimeout(timer); upstream.destroy(); });
      upstream.end();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(54330, 'localhost', resolve);
    });
    phase = 'production-build';
    await run(['run', 'build'], env);
    phase = 'playwright';
    await run(['run', 'test:e2e'], env);
  } finally {
    for (const socket of upgradedSockets) socket.destroy();
    server?.closeAllConnections();
    server?.close();
    if (existsSync(caPath)) unlinkSync(caPath);
    rmdirSync(directory);
  }
}

main().catch(() => {
  console.error(`Isolated TLS dependency lifecycle failed at ${phase}.`);
  process.exitCode = 1;
});
