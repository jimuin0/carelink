/**
 * @jest-environment node
 *
 * Upstash Redis への実到達性テスト（Phase 2 Contract）。
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN が設定された環境でのみ実行。
 * Upstash インスタンス削除（過去事例）を CI で早期検知する層。
 */

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const describeIfConfigured = URL && TOKEN ? describe : describe.skip;

describeIfConfigured('Upstash Redis contract', () => {
  test('ping が PONG を返す', async () => {
    const res = await fetch(`${URL}/ping`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: string };
    expect(json.result).toBe('PONG');
  });
});
