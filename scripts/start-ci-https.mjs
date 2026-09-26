// Production-mode Next.js behind local TLS, only in the disposable GitHub E2E
// lifecycle. WebKit correctly refuses Secure cookies over plain HTTP; changing
// application cookies to insecure would hide that integration requirement.
import { existsSync } from 'node:fs';
import { createServer } from 'node:https';
import { createLocalCertificate } from './ci-test-tls.mjs';

let phase = 'environment';
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || ['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(file))) {
    console.error('Isolated HTTPS E2E environment refused before application startup.');
    process.exitCode = 1;
    return;
  }
  // A test-only TLS private key lives only in this process and OpenSSL stdin.
  // No key file, production material, external CA, or network request is used.
  phase = 'certificate';
  // Node's child stdin may be a socket on Linux. OpenSSL reopens /dev/stdin,
  // which cannot reopen that socket. `cat` supplies a real POSIX pipe instead.
  // The shell program is constant; arguments and key are never interpolated.
  const { key, cert } = createLocalCertificate();
  phase = 'application-import';
  const { default: next } = await import('next');
  const app = next({ dev: false, hostname: 'localhost', port: 3000 });
  phase = 'application-prepare';
  await app.prepare();
  const handler = app.getRequestHandler();
  phase = 'https-server';
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
  // Only this allowlisted phase is reported: child-process errors can contain
  // TLS material and must never be serialized into CI logs.
  console.error(`Isolated HTTPS E2E setup failed at ${phase}; no application was made public.`);
  process.exitCode = 1;
});
