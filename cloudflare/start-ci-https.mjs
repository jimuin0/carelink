import { existsSync } from 'node:fs';
import { preview } from 'vite';
import { createLocalCertificate } from '../scripts/ci-test-tls.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
  || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
  || ['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(file))) {
  console.error('Isolated Cloudflare HTTPS E2E environment refused before startup.');
  process.exitCode = 1;
} else {
  try {
    const { key, cert } = createLocalCertificate();
    const server = await preview({ preview: { host: 'localhost', port: 3000, strictPort: true, https: { key, cert } } });
    const stop = () => server.httpServer.close(() => process.exit());
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch {
    console.error('Isolated Cloudflare HTTPS E2E startup failed; no application was made public.');
    process.exitCode = 1;
  }
}
