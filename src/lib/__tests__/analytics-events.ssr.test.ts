/** @jest-environment node */

import * as analytics from '../analytics-events';

describe('analytics events without a browser', () => {
  test('server rendering has no window and does not access browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(() => analytics.trackBookingStarted('synthetic-facility', 'Synthetic')).not.toThrow();
    expect(() => analytics.trackBookingCompleted('synthetic-facility', 'Synthetic')).not.toThrow();
    expect(() => analytics.trackSignUp('email')).not.toThrow();
  });
});
