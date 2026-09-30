import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { BOOKING_FACILITY_FILE } from './booking.fixtures';

test('同じ予約リクエストの再送は予約・ポイント・通知を重複させない', async ({ request, baseURL }) => {
  const fixture = JSON.parse(fs.readFileSync(BOOKING_FACILITY_FILE, 'utf8')) as {
    facilityId: string;
    staffId: string;
    menuId: string;
  };
  const bookingDate = new Date();
  bookingDate.setMonth(bookingDate.getMonth() + 6);
  const idempotencyKey = randomUUID();
  const headers = {
    Origin: new URL(baseURL ?? 'http://localhost:3000').origin,
    'Idempotency-Key': idempotencyKey,
  };
  const payload = {
    facility_id: fixture.facilityId,
    staff_id: fixture.staffId,
    menu_id: fixture.menuId,
    menu_ids: [fixture.menuId],
    coupon_id: null,
    booking_date: bookingDate.toISOString().slice(0, 10),
    start_time: '10:00',
    end_time: '11:00',
    customer_name: 'Synthetic idempotency test',
    email: `booking-idempotency-${idempotencyKey}@example.invalid`,
    phone: null,
    note: null,
    total_price: 8000,
    points_used: 0,
  };

  const firstResponse = await request.post('/api/booking', { data: payload, headers });
  expect(firstResponse.status()).toBe(200);
  const first = await firstResponse.json() as { success: boolean; bookingId: string };
  expect(first.success).toBe(true);
  expect(first.bookingId).toBeTruthy();

  const retryResponse = await request.post('/api/booking', { data: payload, headers });
  expect(retryResponse.status()).toBe(200);
  expect(await retryResponse.json()).toEqual({
    success: true,
    bookingId: first.bookingId,
    replayed: true,
  });
});
