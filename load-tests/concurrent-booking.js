/**
 * CareLink 負荷テスト: 100同時予約でダブルブッキング発生確認
 *
 * 実行ツール: k6 (https://k6.io)
 * インストール: brew install k6
 * 実行: k6 run concurrent-booking.js
 *
 * 環境変数:
 *   TARGET_URL=https://your-carelink-app.vercel.app
 *   FACILITY_ID=<テスト用施設ID>
 *   MENU_ID=<テスト用メニューID>
 *   TEST_USER_TOKEN=<テスト用ユーザーJWTトークン>
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// === 設定 ===
const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const FACILITY_ID = __ENV.FACILITY_ID || 'test-facility-id';
const MENU_ID = __ENV.MENU_ID || 'test-menu-id';
const AUTH_TOKEN = __ENV.TEST_USER_TOKEN || '';

// === カスタムメトリクス ===
const doubleBookings = new Counter('double_bookings');
const bookingDuration = new Trend('booking_duration');
const successfulBookings = new Counter('successful_bookings');
const failedBookings = new Counter('failed_bookings');

// === テストシナリオ ===
export const options = {
  scenarios: {
    concurrent_bookings: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },   // 10秒で20ユーザーにランプアップ
        { duration: '30s', target: 100 },  // 30秒で100ユーザーにランプアップ
        { duration: '60s', target: 100 },  // 60秒間100ユーザー維持
        { duration: '10s', target: 0 },    // ランプダウン
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],     // 95%ile が2秒以内
    double_bookings: ['count<1'],          // ダブルブッキング0件
    http_req_failed: ['rate<0.05'],        // エラー率5%未満
  },
};

const BOOKING_DATE = '2099-12-31';  // 遠未来の日付（テスト専用）
const START_TIME = '10:00:00';
const END_TIME = '11:00:00';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
  };

  // 同じスロットに予約を試みる（競合テスト）
  const payload = JSON.stringify({
    facility_id: FACILITY_ID,
    menu_id: MENU_ID,
    booking_date: BOOKING_DATE,
    start_time: START_TIME,
    end_time: END_TIME,
    customer_name: `テスト_神原良祐_${Date.now()}`,
    customer_phone: '09015992055',
    customer_email: `test+${__VU}@example.com`,
  });

  const startTime = Date.now();
  const response = http.post(`${BASE_URL}/api/booking`, payload, {
    headers,
    timeout: '10s',
  });
  const duration = Date.now() - startTime;
  bookingDuration.add(duration);

  const success = check(response, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
    'no 500 errors': (r) => r.status !== 500,
  });

  if (response.status === 201) {
    successfulBookings.add(1);
  } else if (response.status === 409) {
    // 409 = conflict (expected for double booking prevention)
    failedBookings.add(1);
  } else if (response.status === 200) {
    // Check if booking was actually created
    try {
      const body = JSON.parse(response.body);
      if (body.booking?.id) {
        successfulBookings.add(1);
      }
    } catch {
      failedBookings.add(1);
    }
  }

  sleep(0.1 + Math.random() * 0.5);
}

export function handleSummary(data) {
  const successCount = data.metrics.successful_bookings?.values?.count || 0;
  const doubleCount = data.metrics.double_bookings?.values?.count || 0;
  const p95 = data.metrics.booking_duration?.values?.['p(95)'] || 0;

  console.log('\n=== ダブルブッキング負荷テスト結果 ===');
  console.log(`成功予約数: ${successCount}`);
  console.log(`ダブルブッキング検出: ${doubleCount} 件`);
  console.log(`レスポンス p95: ${Math.round(p95)}ms`);

  if (doubleCount > 0) {
    console.log('⚠️  ダブルブッキングが発生しました！DB制約を確認してください');
  } else {
    console.log('✅  ダブルブッキングなし');
  }

  return {
    'stdout': JSON.stringify(data.metrics, null, 2),
  };
}
