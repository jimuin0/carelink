/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// Execute the real orchestration with transport/process/filesystem substitutes.
// No credentials, child processes, disk writes, or sockets are used by this harness.
function stream() {
  const value = Object.assign(new EventEmitter(), {
    destroyed: false, headersSent: false,
    write: jest.fn(), writeHead: jest.fn(), end: jest.fn(), pipe: jest.fn(),
    destroy: jest.fn(), setTimeout: jest.fn(), resume: jest.fn(),
  });
  value.writeHead.mockReturnValue(value);
  value.end.mockReturnValue(value);
  value.pipe.mockImplementation((target: unknown) => target);
  value.destroy.mockImplementation(() => {
    if (!value.destroyed) { value.destroyed = true; value.emit('close'); }
  });
  return value;
}

async function harness() {
  const server = Object.assign(new EventEmitter(), {
    listen: jest.fn((_port: number, _host: string, ready: () => void) => ready()), close: jest.fn(), closeAllConnections: jest.fn(),
  });
  const children: Array<EventEmitter & { pid: number }> = [];
  const spawn = jest.fn((_command: string, _args: string[], _options: { env: NodeJS.ProcessEnv; stdio: string; detached: boolean }) => {
    const child = Object.assign(new EventEmitter(), { pid: 10000 + children.length });
    children.push(child); return child;
  });
  const upstreams: ReturnType<typeof stream>[] = [];
  const httpRequest = jest.fn((_options: Record<string, unknown>, callback?: (...args: unknown[]) => void) => {
    const upstream = stream(); upstreams.push(upstream);
    if (callback) upstream.on('response', callback);
    return upstream;
  });
  let handler: (request: unknown, response: unknown) => void = () => {};
  const fs = { existsSync: jest.fn((path: string) => path.endsWith('certificate.pem')),
    mkdtempSync: jest.fn(() => '/tmp/fixture-public-ca'), writeFileSync: jest.fn(), unlinkSync: jest.fn(), rmdirSync: jest.fn() };
  const process = Object.assign(new EventEmitter(), {
    env: { CI: 'true', GITHUB_ACTIONS: 'true', PLAYWRIGHT_BASE_URL: 'https://localhost:3000',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', RUNNER_TEMP: '/tmp' }, exitCode: 0,
    kill: jest.fn((_pid: number, signal: string | number) => { if (signal === 0) throw new Error('exited'); }),
  });
  const error = jest.fn();
  const source = readFileSync(join(__dirname, '../../scripts/run-ci-e2e.mjs'), 'utf8');
  const modules: Record<string, unknown> = {
    'node:fs': fs, 'node:path': require('node:path'), 'node:crypto': { randomBytes: () => Buffer.from('fixture') },
    'node:child_process': { spawn }, 'node:http': { request: httpRequest },
    'node:https': { createServer: (_tls: unknown, callback: typeof handler) => { handler = callback; return server; } },
    './ci-test-tls.mjs': { createLocalCertificate: () => ({ key: 'PRIVATE_FIXTURE', cert: 'PUBLIC_FIXTURE' }) },
  };
  runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText, {
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected import'); return modules[name]; },
    exports: {}, process, console: { error }, setTimeout, clearTimeout,
  });
  const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  await flush();
  const finish = async (code = 0) => {
    children[0].emit('exit', code); await flush();
    if (children[1]) { children[1].emit('exit', code); await flush(); }
  };
  return { server, children, spawn, upstreams, httpRequest, handler, fs, process, error, flush, finish };
}

test('one trusted HTTPS origin is used for build and E2E; only public certificate persists and is removed', async () => {
  const h = await harness();
  expect(h.spawn).toHaveBeenCalledTimes(1);
  expect(h.server.listen).toHaveBeenCalledWith(54330, 'localhost', expect.any(Function));
  expect(h.fs.writeFileSync).toHaveBeenCalledWith('/tmp/fixture-public-ca/certificate.pem', 'PUBLIC_FIXTURE', expect.anything());
  await h.finish();
  expect(h.spawn.mock.calls.map(call => call[1])).toEqual([['run', 'build'], ['run', 'test:e2e']]);
  for (const call of h.spawn.mock.calls) {
    expect(call[2]).toMatchObject({ detached: true, env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330', NODE_EXTRA_CA_CERTS: '/tmp/fixture-public-ca/certificate.pem',
    } });
    expect(call[2].env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  }
  expect(h.fs.unlinkSync).toHaveBeenCalledWith('/tmp/fixture-public-ca/certificate.pem');
  expect(h.fs.rmdirSync).toHaveBeenCalledWith('/tmp/fixture-public-ca');
  expect(h.error).not.toHaveBeenCalled();
});

test('HTTP forwards exact body stream, authorization and all response cookies only to the fixed upstream', async () => {
  const h = await harness();
  const req = Object.assign(stream(), { url: '/auth/v1/signup?fixture=1', method: 'POST', headers: { authorization: 'fixture', host: 'attacker.invalid' } });
  const res = stream();
  h.handler(req, res);
  expect(h.httpRequest.mock.calls[0][0]).toMatchObject({ hostname: '127.0.0.1', port: 54321, path: req.url,
    headers: { authorization: 'fixture', host: '127.0.0.1:54321' } });
  expect(req.pipe).toHaveBeenCalledWith(h.upstreams[0]);
  const result = Object.assign(stream(), { statusCode: 201, headers: { 'set-cookie': ['a=fixture', 'b=fixture'] } });
  h.upstreams[0].emit('response', result);
  expect(res.writeHead).toHaveBeenCalledWith(201, result.headers);
  expect(result.pipe).toHaveBeenCalledWith(res);
  req.emit('aborted');
  expect(h.upstreams[0].destroy).toHaveBeenCalled();
  await h.finish();
});

test.each(['https://attacker.invalid', '//attacker.invalid'])('refuses a non-origin request target %s', async url => {
  const h = await harness(); const res = stream();
  h.handler({ url }, res);
  expect(res.writeHead).toHaveBeenCalledWith(400);
  expect(h.httpRequest).not.toHaveBeenCalled(); await h.finish();
});

test('upstream errors are 502 without raw details, build failure prevents E2E and cleans resources', async () => {
  const h = await harness(); const res = stream();
  h.handler(Object.assign(stream(), { url: '/rest/v1/', headers: {}, method: 'GET' }), res);
  h.upstreams[0].emit('error', new Error('PRIVATE_FIXTURE'));
  expect(res.writeHead).toHaveBeenCalledWith(502);
  await h.finish(1);
  expect(h.spawn).toHaveBeenCalledTimes(1);
  expect(h.fs.unlinkSync).toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledWith('Isolated TLS dependency lifecycle failed at production-build.');
});

test('WebSocket errors before handshake and invalid upgrades are contained', async () => {
  const h = await harness(); const socket = stream();
  h.server.emit('upgrade', { url: '/realtime/v1/websocket', headers: { upgrade: 'websocket' } }, socket, Buffer.alloc(0));
  expect(() => socket.emit('error', new Error('reset'))).not.toThrow();
  expect(h.upstreams[0].destroy).toHaveBeenCalled();
  const bad = stream(); h.server.emit('upgrade', { url: '/other', headers: {} }, bad, Buffer.alloc(0));
  expect(bad.end).toHaveBeenCalledWith(expect.stringContaining('400'));
  expect(() => bad.emit('error', new Error('reset'))).not.toThrow();
  await h.finish();
});

test('upgraded peers, initial frame bytes and process groups are handled through cleanup', async () => {
  const h = await harness(); const socket = stream(); const peer = stream();
  h.server.emit('upgrade', { url: '/realtime/v1/websocket', headers: { upgrade: 'websocket' } }, socket, Buffer.from('client'));
  h.upstreams[0].emit('upgrade', { rawHeaders: ['Upgrade', 'websocket'] }, peer, Buffer.from('server'));
  expect(socket.write).toHaveBeenCalledWith(Buffer.from('server'));
  expect(peer.write).toHaveBeenCalledWith(Buffer.from('client'));
  await h.finish();
  expect(socket.destroyed).toBe(true); expect(peer.destroyed).toBe(true);
  expect(h.process.kill).toHaveBeenCalledWith(-10000, 'SIGTERM');
  expect(h.server.closeAllConnections).toHaveBeenCalled();
});
