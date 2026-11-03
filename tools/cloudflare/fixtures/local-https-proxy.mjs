import { createServer } from 'node:https';
import { request as upstreamRequest } from 'node:http';
import { createLocalCertificate } from '../../../scripts/ci-test-tls.mjs';
import { isolatedStack } from './assert-local-stack.mjs';

// Local-only HTTPS to the existing Worker; neither private key nor traffic is logged.
isolatedStack();
const server = createServer(createLocalCertificate(), (req, res) => {
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) return res.writeHead(400).end();
  const upstream = upstreamRequest({ hostname: '127.0.0.1', port: 18744, method: req.method,
    path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
});
server.listen(18747, '127.0.0.1', () => console.log('Local HTTPS proxy ready on 127.0.0.1:18747'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
