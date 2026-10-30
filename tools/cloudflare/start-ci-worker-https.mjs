// Disposable GitHub CI only: local workerd behind loopback TLS. Never deploys.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as upstreamRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createLocalCertificate } from '../../scripts/ci-test-tls.mjs';

const forbidden = ['RESEND_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN_CARELINK', 'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_SECRET_CARELINK', 'LINE_WORKS_CLIENT_SECRET', 'LINE_WORKS_PRIVATE_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'THREADS_USER_ID', 'ANTHROPIC_API_KEY',
  'GOOGLE_CLIENT_SECRET', 'GOOGLE_MAPS_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
  || process.env.CARELINK_CI_WORKER !== '1'
  || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
  || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.ADMIN_COOKIE_SECRET
  || forbidden.some(name => process.env[name])
  || ['.env', '.env.local', '.env.production', '.env.production.local'].some(existsSync)) {
  console.error('Isolated Worker HTTPS E2E environment refused before startup.');
  process.exit(1);
}
const configPath = 'dist/server/wrangler-ci-e2e.json';
const varsPath = 'dist/server/.dev.vars';
let worker;
let server;
let configCreated = false;
let varsCreated = false;
let closing = false;
function cleanup() {
  if (closing) return;
  closing = true;
  server?.close();
  worker?.kill('SIGTERM');
  if (varsCreated) unlinkSync(varsPath);
  if (configCreated) unlinkSync(configPath);
}
try {
  const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  config.name = 'carelink-disposable-ci-e2e';
  config.workers_dev = false;
  config.vars = { ...config.vars, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_BASE_URL: 'https://localhost:3000', SALON_REGISTRATION_V2_ENABLED: 'true', THREADS_USER_ID: '' };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' }); configCreated = true;
  const values = { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_COOKIE_SECRET: process.env.ADMIN_COOKIE_SECRET, CRON_SECRET: randomBytes(32).toString('hex') };
  writeFileSync(varsPath, Object.entries(values).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' }); varsCreated = true;
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '18744', '--config', configPath, '--env-file', varsPath, '--log-level', 'error'], { stdio: 'ignore', env: process.env });
  worker.once('error', () => { cleanup(); process.exitCode = 1; });
  worker.once('exit', () => { if (!closing) { console.error('Disposable local Worker exited.'); cleanup(); process.exitCode = 1; } });
  server = createServer(createLocalCertificate(), (req, res) => {
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) return res.writeHead(400).end();
    const upstream = upstreamRequest({ hostname: '127.0.0.1', port: 18744, method: req.method,
      path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, response => {
      res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  server.on('error', () => { cleanup(); process.exitCode = 1; });
  server.listen(3000, 'localhost');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { cleanup(); process.exit(); });
} catch {
  cleanup(); console.error('Disposable local Worker startup failed.'); process.exitCode = 1;
}
