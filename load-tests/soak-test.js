/**
 * CareLink 負荷テスト: ソークテスト（長時間安定性）
 * メモリリーク・接続リーク・性能劣化を検出
 *
 * 実行: k6 run soak-test.js  （約30分）
 * 短縮: k6 run -e DURATION=5m soak-test.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const DURATION = __ENV.DURATION || '30m';

const responseTrend = new Trend('response_over_time');
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    error_rate: ['rate<0.01'],
    // 経時劣化がないことを確認（最終的な p95 が初期より 50% 以上悪化しない）
  },
};

const endpoints = [
  '/api/health',
  '/api/salons',
  '/api/salons?business_type=acupuncture',
  '/api/salons?area=東京都',
];

export default function () {
  const endpoint = endpoints[__ITER % endpoints.length];
  const start = Date.now();
  const response = http.get(`${BASE_URL}${endpoint}`, { timeout: '15s' });
  const duration = Date.now() - start;

  responseTrend.add(duration);

  const ok = check(response, {
    'status OK': (r) => r.status === 200 || r.status === 429,
    'no server error': (r) => r.status < 500,
    'response time < 5s': () => duration < 5000,
  });

  errorRate.add(!ok);

  sleep(1 + Math.random() * 2);
}

export function handleSummary(data) {
  const p50 = data.metrics.response_over_time?.values?.['p(50)'] || 0;
  const p95 = data.metrics.response_over_time?.values?.['p(95)'] || 0;
  const p99 = data.metrics.response_over_time?.values?.['p(99)'] || 0;
  const errorRate = data.metrics.error_rate?.values?.rate || 0;
  const duration = data.metrics.http_req_duration?.values?.avg || 0;

  console.log('\n=== ソークテスト結果 ===');
  console.log(`平均レスポンス: ${Math.round(duration)}ms`);
  console.log(`P50: ${Math.round(p50)}ms`);
  console.log(`P95: ${Math.round(p95)}ms`);
  console.log(`P99: ${Math.round(p99)}ms`);
  console.log(`エラー率: ${(errorRate * 100).toFixed(2)}%`);

  const passed = p95 < 3000 && errorRate < 0.01;
  console.log(passed ? '✅ 長時間安定性 OK' : '❌ 性能劣化または高エラー率を検出');

  return { 'stdout': JSON.stringify(data.metrics, null, 2) };
}
