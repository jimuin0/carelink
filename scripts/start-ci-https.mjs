// Production-mode Next.js behind local TLS, only in the disposable GitHub E2E
// lifecycle. WebKit correctly refuses Secure cookies over plain HTTP; changing
// application cookies to insecure would hide that integration requirement.
import { existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    || ['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(file))) {
    console.error('Isolated HTTPS E2E environment refused before application startup.');
    process.exitCode = 1;
    return;
  }
  // A test-only TLS private key lives only in this process and OpenSSL stdin.
  // No key file, production material, external CA, or network request is used.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const cert = execFileSync('openssl', [
    'req', '-new', '-x509', '-key', '/dev/stdin', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '1',
  ], { input: key, env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
  const { default: next } = await import('next');
  const app = next({ dev: false, hostname: 'localhost', port: 3000 });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer({ key, cert }, (request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.on('error', () => { console.error('Isolated HTTPS E2E server failed.'); process.exitCode = 1; });
  server.listen(3000, 'localhost');
  const stop = () => { server.close(); void app.close().finally(() => process.exit()); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch(() => {
  console.error('Isolated HTTPS E2E setup failed; no application was made public.');
  process.exitCode = 1;
});
