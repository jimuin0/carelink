/** @jest-environment node */
/**
 * 公開読み取りの接続プールが、実行中の Node の fetch で本当に通信できることを確かめる。
 *
 * 🔴 why(2026-11-03 実測): `public-read-transport.ts` は package の `undici` の Agent を
 *   Node 内蔵の fetch へ `dispatcher` として渡している。内蔵 fetch と package の undici の
 *   世代が合わないと、Agent は作れるのに **fetch するたびに `TypeError: fetch failed`
 *   （cause: `invalid onRequestStart method`）** になり、公開ページの DB 読み込みが全滅する。
 *   本番と同じ Node 24.22.1（内蔵 undici 7.30.1）で実測:
 *     - undici 7.30.1 の Agent → 200
 *     - undici 8.12.3 の Agent → `invalid onRequestStart method` で失敗
 *   Dependabot の undici 8 の PR（#892）は、単体テスト・型検査・lint がすべて緑だった。
 *   既存の単体テストは undici をモックしているので、この組み合わせを一度も実行していない。
 *
 * 【なぜ版の表を持たないか】Node の版と内蔵 undici の対応表は、Node を上げるたびに腐る。
 *   ここでは「CI の Node で、インストールされた undici を使って、実際に 1 往復できるか」
 *   という外形だけを見る。undici か Node のどちらかを上げて組み合わせが壊れれば、何であれ落ちる。
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPublicReadFetch, createServiceReadFetch } from '../public-read-transport';

let server: Server;
let origin: string;
const seen: Array<{ method?: string; url?: string; headers: IncomingHttpHeaders }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify([{ id: 1 }]));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => { seen.length = 0; });

it('インストールされた undici の Agent で Node 内蔵の fetch が通信できる', async () => {
  const { Agent } = await import('undici');
  const agent = new Agent({ connections: 1 });
  try {
    const response = await fetch(`${origin}/direct`, { dispatcher: agent } as RequestInit);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1 }]);
  } finally {
    await agent.close();
  }
  expect(seen).toEqual([expect.objectContaining({ method: 'GET', url: '/direct' })]);
});

it.each([
  ['公開用', createPublicReadFetch],
  ['サーバー用', createServiceReadFetch],
])('%s の接続プールを通した GET・HEAD が届き、ヘッダーを保つ', async (_label, create) => {
  const read = create(origin);
  const response = await read(`${origin}/rest/v1/facilities?select=id`, {
    headers: { apikey: 'synthetic-public-key' },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ id: 1 }]);
  const head = await read(new Request(`${origin}/rest/v1/facilities`, { method: 'HEAD' }));
  expect(head.status).toBe(200);

  expect(seen).toEqual([
    expect.objectContaining({ method: 'GET', url: '/rest/v1/facilities?select=id' }),
    expect.objectContaining({ method: 'HEAD', url: '/rest/v1/facilities' }),
  ]);
  expect(seen[0].headers.apikey).toBe('synthetic-public-key');
});
