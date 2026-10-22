/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 予約の状態変更・会計で、ポイントの台帳と照合できなかったときの判定と応答（2026年10月23日）。
 * 以前は /api/admin/booking-status・/api/admin/booking-checkout が区別せず 500 にしていた。
 */
jest.mock('../alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('../safe', () => ({ safeCaptureException: jest.fn() }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertCaughtError } from '../alert';
import { safeCaptureException } from '../safe';
import {
  BOOKING_POINTS_CONFLICT_CODE,
  BOOKING_POINTS_ERROR_CODES,
  bookingPointsConflict,
  isBookingPointsError,
} from '../booking-points-error';

describe('isBookingPointsError', () => {
  test.each([...BOOKING_POINTS_ERROR_CODES])('%s はポイントの照合エラー', (code) => {
    expect(isBookingPointsError(code)).toBe(true);
    // 「コード: 説明」の形で来ても同じ
    expect(isBookingPointsError(`${code}: synthetic`)).toBe(true);
  });

  test.each([
    'SYNTHETIC_POINT_FAILURE', 'BOOKING_CONFLICT: この時間帯は既に予約が入っています', 'BOOKING_REVISION_CONFLICT',
    'XPOINTS_AUTH_REQUIRED', '', 'toString',
  ])('%j は照合エラーではない（完全一致だけ）', (message) => {
    expect(isBookingPointsError(message)).toBe(false);
  });

  test.each([undefined, null, 42, { message: 'POINTS_AUTH_REQUIRED' }])('文字列でない %j は照合エラーではない', (message) => {
    expect(isBookingPointsError(message)).toBe(false);
  });

  // DB が投げるコードと一覧がずれると、ずれたコードだけ 500 に戻る。トリガと台帳のガードが投げる全コードを含む。
  test('sync_booking_points と guard_user_point_ledger が投げるコードを全部含む', () => {
    const migrations = join(process.cwd(), 'supabase/migrations');
    const sources = [
      readFileSync(join(migrations, '20261023130000_booking_points_withdrawn_member.sql'), 'utf8'),
      readFileSync(join(migrations, '20261008080209_atomic_booking_points.sql'), 'utf8'),
    ];
    const raised = new Set<string>();
    for (const sql of sources) {
      for (const name of ['sync_booking_points', 'guard_user_point_ledger']) {
        const start = sql.indexOf(`FUNCTION public.${name}()`);
        if (start < 0) continue;
        const body = sql.slice(start, sql.indexOf('END $$;', start));
        for (const m of body.matchAll(/RAISE EXCEPTION '([A-Z_]+)'/g)) raised.add(m[1]);
      }
    }
    expect(raised.size).toBeGreaterThanOrEqual(4);
    for (const code of raised) expect([code, BOOKING_POINTS_ERROR_CODES.includes(code)]).toEqual([code, true]);
  });
});

describe('bookingPointsConflict', () => {
  test('409・理由と code を返し、運営へ通知する', async () => {
    const cause = { code: 'P0001', message: 'POINTS_AUTH_REQUIRED' };
    const res = bookingPointsConflict('synthetic-tag', cause, '/api/synthetic', '案内文');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '案内文', code: BOOKING_POINTS_CONFLICT_CODE });
    expect(BOOKING_POINTS_CONFLICT_CODE).toBe('BOOKING_POINTS_RECONCILIATION_REQUIRED');
    expect(safeCaptureException).toHaveBeenCalledWith(cause, 'synthetic-tag');
    expect(alertCaughtError).toHaveBeenCalledWith('synthetic-tag', cause, '/api/synthetic');
  });
});
