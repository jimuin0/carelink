/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Vercel のサーバー関数はデータベース（Supabase project xzafxiupbflvgbarrihe、
 * region ap-northeast-1＝東京）の近くで動かす（2026年10月22日）。
 * 指定が無いと既定の iad1（米国東部）で動き、店舗ページや予約ページは
 * 1 回の表示で何度も東京の DB へ往復するため、応答開始まで 1.3〜3.3 秒かかっていた
 * （x-vercel-id が kix1::iad1 だったことで判明）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('server functions run in Tokyo (hnd1), next to the Supabase database', () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
  expect(config.regions).toEqual(['hnd1']);
});
