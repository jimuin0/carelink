/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { NEW_BOOKING_MAX_LOOKBACK_MS, NEW_BOOKING_OVERLAP_MS, nextSince, resolveSince, takeUnseen } from '../new-booking-poll';

const now = Date.parse('2026-10-21T12:00:00.000Z');

describe('resolveSince', () => {
  it('defaults a missing or malformed value to the overlap window', () => {
    const expected = new Date(now - NEW_BOOKING_OVERLAP_MS).toISOString();
    expect(resolveSince(null, now)).toBe(expected);
    expect(resolveSince('not-a-date', now)).toBe(expected);
  });

  it('keeps a value inside the allowed range', () => {
    expect(resolveSince('2026-10-21T11:30:00.000Z', now)).toBe('2026-10-21T11:30:00.000Z');
  });

  it('clamps future and too-old values', () => {
    expect(resolveSince('2026-10-22T00:00:00.000Z', now)).toBe(new Date(now).toISOString());
    expect(resolveSince('2026-01-01T00:00:00.000Z', now)).toBe(new Date(now - NEW_BOOKING_MAX_LOOKBACK_MS).toISOString());
  });
});

describe('nextSince', () => {
  it('reaches back by the overlap window from the server time', () => {
    expect(nextSince('2026-10-21T12:00:00.000Z')).toBe('2026-10-21T11:58:00.000Z');
  });
});

describe('takeUnseen', () => {
  const a = { id: 'a', customer_name: 'A', booking_date: '2026-10-23', start_time: '09:00:00', created_at: '2026-10-21T11:59:00Z' };
  const b = { ...a, id: 'b' };

  it('returns each booking once across overlapping responses', () => {
    const seen = new Set<string>();
    expect(takeUnseen([a], seen)).toEqual([a]);
    expect(takeUnseen([a, b], seen)).toEqual([b]);
    expect(takeUnseen([a, b], seen)).toEqual([]);
  });
});
