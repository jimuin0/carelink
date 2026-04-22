/**
 * Tests for lib/analytics.ts
 * Verifies each analytics method calls window.gtag with the correct event/params.
 */

import { analytics } from '../analytics';

let mockGtag: jest.Mock;

beforeEach(() => {
  mockGtag = jest.fn();
  (window as Window & { gtag?: jest.Mock }).gtag = mockGtag;
});

afterEach(() => {
  delete (window as Window & { gtag?: jest.Mock }).gtag;
});

describe('analytics', () => {
  test('searchPerformed calls gtag with search event', () => {
    analytics.searchPerformed('nail');
    expect(mockGtag).toHaveBeenCalledWith('event', 'search', { search_term: 'nail' });
  });

  test('facilityViewed calls gtag with facility_view event', () => {
    analytics.facilityViewed('my-salon', 'nail-eyelash');
    expect(mockGtag).toHaveBeenCalledWith('event', 'facility_view', {
      facility_slug: 'my-salon',
      business_type: 'nail-eyelash',
    });
  });

  test('bookingClicked calls gtag with booking_click event', () => {
    analytics.bookingClicked('my-salon');
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_click', { facility_slug: 'my-salon' });
  });

  test('phoneClicked calls gtag with phone_click event', () => {
    analytics.phoneClicked('my-salon');
    expect(mockGtag).toHaveBeenCalledWith('event', 'phone_click', { facility_slug: 'my-salon' });
  });

  test('favoriteToggled add calls gtag with favorite_toggle', () => {
    analytics.favoriteToggled('fac-1', 'add');
    expect(mockGtag).toHaveBeenCalledWith('event', 'favorite_toggle', {
      facility_id: 'fac-1',
      action: 'add',
    });
  });

  test('favoriteToggled remove calls gtag with favorite_toggle', () => {
    analytics.favoriteToggled('fac-1', 'remove');
    expect(mockGtag).toHaveBeenCalledWith('event', 'favorite_toggle', {
      facility_id: 'fac-1',
      action: 'remove',
    });
  });

  test('couponViewed calls gtag with coupon_view event', () => {
    analytics.couponViewed('coupon-abc');
    expect(mockGtag).toHaveBeenCalledWith('event', 'coupon_view', { coupon_id: 'coupon-abc' });
  });

  test('inquirySubmitted calls gtag with inquiry_submit event', () => {
    analytics.inquirySubmitted('fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'inquiry_submit', { facility_id: 'fac-1' });
  });

  test('filterApplied calls gtag with filter_applied event', () => {
    analytics.filterApplied('business_type');
    expect(mockGtag).toHaveBeenCalledWith('event', 'filter_applied', { filter_type: 'business_type' });
  });

  test('no gtag → all methods silently do nothing', () => {
    delete (window as Window & { gtag?: jest.Mock }).gtag;
    expect(() => analytics.searchPerformed('nail')).not.toThrow();
    expect(() => analytics.facilityViewed('slug', 'type')).not.toThrow();
    expect(() => analytics.bookingClicked('slug')).not.toThrow();
    expect(() => analytics.phoneClicked('slug')).not.toThrow();
    expect(() => analytics.favoriteToggled('id', 'add')).not.toThrow();
    expect(() => analytics.couponViewed('id')).not.toThrow();
    expect(() => analytics.inquirySubmitted('id')).not.toThrow();
    expect(() => analytics.filterApplied('type')).not.toThrow();
    expect(mockGtag).not.toHaveBeenCalled();
  });
});
