/**
 * CareLink 負荷テスト: 検索エンドポイント
 *
 * 実行: k6 run search-load.js
 * 本番: k6 run -e TARGET_URL=https://carelink-jp.com search-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

const searchDuration = new Trend('search_duration');
const searchSuccessRate = new Rate('search_success_rate');
const rateLimitCount = new Counter('rate_limit_hits');

export const options = {
  scenarios: {
    // 通常負荷
    normal_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
    },
    // スパイク
    spike: {
      executor: 'ramping-vus',
      startTime: '2m',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    search_success_rate: ['rate>0.95'],
    http_req_failed: ['rate<0.05'],
  },
};

const searchQueries = [
  '鍼灸',
  '整体',
  'エステ',
  'マッサージ',
  'カイロプラクティック',
  '',  // 全件取得
];

const areas = [
  '東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '',
];

const businessTypes = [
  'acupuncture', 'massage', 'esthetic', '', '',
];

export default function () {
  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  const area = areas[Math.floor(Math.random() * areas.length)];
  const type = businessTypes[Math.floor(Math.random() * businessTypes.length)];

  const params: string[] = [];
  if (query) params.push(`q=${encodeURIComponent(query)}`);
  if (area) params.push(`area=${encodeURIComponent(area)}`);
  if (type) params.push(`business_type=${type}`);

  const url = `${BASE_URL}/api/salons${params.length ? `?${params.join('&')}` : ''}`;

  const start = Date.now();
  const response = http.get(url, {
    headers: { 'Accept': 'application/json' },
    timeout: '10s',
  });
  const duration = Date.now() - start;
  searchDuration.add(duration);

  const success = check(response, {
    'status 200 or 429': (r) => r.status === 200 || r.status === 429,
    'no 500': (r) => r.status !== 500,
    'valid JSON': (r) => {
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  searchSuccessRate.add(success);
  if (response.status === 429) rateLimitCount.add(1);

  sleep(0.5 + Math.random() * 1.5);
}

export function handleSummary(data) {
  const p95 = data.metrics.search_duration?.values?.['p(95)'] || 0;
  const p99 = data.metrics.search_duration?.values?.['p(99)'] || 0;
  const successRate = data.metrics.search_success_rate?.values?.rate || 0;
  const rateLimits = data.metrics.rate_limit_hits?.values?.count || 0;

  console.log('\n=== 検索負荷テスト結果 ===');
  console.log(`P95 レスポンスタイム: ${Math.round(p95)}ms`);
  console.log(`P99 レスポンスタイム: ${Math.round(p99)}ms`);
  console.log(`成功率: ${(successRate * 100).toFixed(1)}%`);
  console.log(`レート制限ヒット: ${rateLimits} 件`);

  const passed = p95 < 3000 && successRate > 0.95;
  console.log(passed ? '✅ テスト合格' : '❌ テスト不合格');

  return { 'stdout': JSON.stringify(data.metrics, null, 2) };
}
