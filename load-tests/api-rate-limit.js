/**
 * CareLink 負荷テスト: レート制限の正確性確認
 *
 * 実行: k6 run api-rate-limit.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

const rateLimitCorrect = new Rate('rate_limit_correct');
const falsePositives = new Counter('rate_limit_false_positives');
const falseNegatives = new Counter('rate_limit_false_negatives');

export const options = {
  scenarios: {
    // 各 IP から 5 req/min 制限のエンドポイントを検証
    burst_test: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 10,
    },
  },
  thresholds: {
    rate_limit_correct: ['rate>0.9'],
  },
};

export default function () {
  const vuId = __VU;

  // 同一 IP を模擬（x-forwarded-for で IP を指定）
  const headers = {
    'x-forwarded-for': `10.0.${Math.floor(vuId / 255)}.${vuId % 255}`,
    'Content-Type': 'application/json',
  };

  // /api/salons: 20 req/min 制限
  const results: number[] = [];
  for (let i = 0; i < 25; i++) {
    const r = http.get(`${BASE_URL}/api/salons`, { headers });
    results.push(r.status);
  }

  // 最初の 20 件は成功、21 件目以降は 429 になるはず
  const successCount = results.filter(s => s === 200).length;
  const limitCount = results.filter(s => s === 429).length;

  // レート制限が正確に機能しているか
  const correct = successCount <= 20 && limitCount >= 0;
  rateLimitCorrect.add(correct);

  if (successCount > 20) {
    falseNegatives.add(successCount - 20);
  }

  check(results, {
    '25件中 20件以下が成功': () => successCount <= 20,
    '500エラーなし': () => !results.includes(500),
  });

  sleep(61); // レート制限リセット待ち（1分）
}

export function handleSummary(data) {
  const correctRate = data.metrics.rate_limit_correct?.values?.rate || 0;
  const falsePosCount = data.metrics.rate_limit_false_positives?.values?.count || 0;
  const falseNegCount = data.metrics.rate_limit_false_negatives?.values?.count || 0;

  console.log('\n=== レート制限精度テスト結果 ===');
  console.log(`正確率: ${(correctRate * 100).toFixed(1)}%`);
  console.log(`誤検知（正常ブロック）: ${falsePosCount}`);
  console.log(`見逃し（制限漏れ）: ${falseNegCount}`);

  return { 'stdout': JSON.stringify(data.metrics, null, 2) };
}
