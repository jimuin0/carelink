/**
 * Tests for lib/analytics-events.ts
 * Verifies each tracking function calls window.gtag with the correct event name and params.
 */

import {
  trackBookingStarted,
  trackBookingCompleted,
  trackBookingCancelled,
  trackSearch,
  trackFacilityViewed,
  trackPhoneClicked,
  trackReviewStarted,
  trackReviewSubmitted,
  trackFavoriteAdded,
  trackFavoriteRemoved,
  trackCouponViewed,
  trackCouponRedeemed,
  trackPackagePurchased,
  trackSubscriptionStarted,
  trackSignUp,
  trackLogin,
  trackShare,
  trackSymptomChecked,
  trackNpsSubmitted,
} from '../analytics-events';

let mockGtag: jest.Mock;

beforeEach(() => {
  mockGtag = jest.fn();
  (window as Window & { gtag?: jest.Mock }).gtag = mockGtag;
});

afterEach(() => {
  delete (window as Window & { gtag?: jest.Mock }).gtag;
});

describe('analytics-events', () => {
  test('trackBookingStarted calls gtag with booking_started', () => {
    trackBookingStarted('fac-1', 'Test Salon');
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_started', {
      facility_id: 'fac-1',
      facility_name: 'Test Salon',
    });
  });

  test('trackBookingCompleted calls gtag with booking_completed', () => {
    trackBookingCompleted('fac-1', 'Salon', 'Cut', 3000);
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_completed', expect.objectContaining({
      facility_id: 'fac-1',
      value: 3000,
      currency: 'JPY',
    }));
  });

  test('trackBookingCompleted without optional params', () => {
    trackBookingCompleted('fac-1', 'Salon');
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_completed', {
      facility_id: 'fac-1',
      facility_name: 'Salon',
    });
  });

  test('trackBookingCancelled calls gtag with booking_cancelled', () => {
    trackBookingCancelled('book-1', 'schedule_conflict');
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_cancelled', {
      booking_id: 'book-1',
      reason: 'schedule_conflict',
    });
  });

  test('trackBookingCancelled without reason', () => {
    trackBookingCancelled('book-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'booking_cancelled', { booking_id: 'book-1' });
  });

  test('trackSearch calls gtag with search event', () => {
    trackSearch('nail salon', 'facility', '東京都', 10);
    expect(mockGtag).toHaveBeenCalledWith('event', 'search', expect.objectContaining({
      search_term: 'nail salon',
      content_type: 'facility',
      prefecture: '東京都',
      result_count: 10,
    }));
  });

  test('trackSearch with minimal params', () => {
    trackSearch('nail');
    expect(mockGtag).toHaveBeenCalledWith('event', 'search', { search_term: 'nail' });
  });

  test('trackFacilityViewed calls gtag with facility_viewed', () => {
    trackFacilityViewed('fac-1', 'Test Salon', 'nail');
    expect(mockGtag).toHaveBeenCalledWith('event', 'facility_viewed', {
      facility_id: 'fac-1',
      facility_name: 'Test Salon',
      business_type: 'nail',
    });
  });

  test('trackPhoneClicked calls gtag with phone_clicked', () => {
    trackPhoneClicked('fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'phone_clicked', { facility_id: 'fac-1' });
  });

  test('trackReviewStarted calls gtag with review_started', () => {
    trackReviewStarted('fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'review_started', { facility_id: 'fac-1' });
  });

  test('trackReviewSubmitted calls gtag with review_submitted', () => {
    trackReviewSubmitted('fac-1', 4);
    expect(mockGtag).toHaveBeenCalledWith('event', 'review_submitted', { facility_id: 'fac-1', rating: 4 });
  });

  test('trackFavoriteAdded calls gtag with favorite_added', () => {
    trackFavoriteAdded('fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'favorite_added', { facility_id: 'fac-1' });
  });

  test('trackFavoriteRemoved calls gtag with favorite_removed', () => {
    trackFavoriteRemoved('fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'favorite_removed', { facility_id: 'fac-1' });
  });

  test('trackCouponViewed calls gtag with coupon_viewed', () => {
    trackCouponViewed('coupon-1', 500);
    expect(mockGtag).toHaveBeenCalledWith('event', 'coupon_viewed', { coupon_id: 'coupon-1', discount_value: 500 });
  });

  test('trackCouponRedeemed calls gtag with coupon_redeemed', () => {
    trackCouponRedeemed('coupon-1', 'fac-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'coupon_redeemed', { coupon_id: 'coupon-1', facility_id: 'fac-1' });
  });

  test('trackPackagePurchased calls gtag with package_purchased', () => {
    trackPackagePurchased('pkg-1', '10回券', 30000);
    expect(mockGtag).toHaveBeenCalledWith('event', 'package_purchased', {
      package_id: 'pkg-1',
      package_name: '10回券',
      value: 30000,
      currency: 'JPY',
    });
  });

  test('trackSubscriptionStarted calls gtag with subscription_started', () => {
    trackSubscriptionStarted('plan-1', 'Premium', 9800);
    expect(mockGtag).toHaveBeenCalledWith('event', 'subscription_started', {
      plan_id: 'plan-1',
      plan_name: 'Premium',
      value: 9800,
      currency: 'JPY',
    });
  });

  test('trackSignUp calls gtag with sign_up', () => {
    trackSignUp('line');
    expect(mockGtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'line' });
  });

  test('trackLogin calls gtag with login', () => {
    trackLogin('email');
    expect(mockGtag).toHaveBeenCalledWith('event', 'login', { method: 'email' });
  });

  test('trackShare calls gtag with share', () => {
    trackShare('facility', 'fac-1', 'twitter');
    expect(mockGtag).toHaveBeenCalledWith('event', 'share', {
      content_type: 'facility',
      item_id: 'fac-1',
      method: 'twitter',
    });
  });

  test('trackSymptomChecked calls gtag with symptom_checked', () => {
    trackSymptomChecked('headache,back pain', 5);
    expect(mockGtag).toHaveBeenCalledWith('event', 'symptom_checked', {
      symptoms: 'headache,back pain',
      result_count: 5,
    });
  });

  test('trackNpsSubmitted calls gtag with nps_submitted', () => {
    trackNpsSubmitted(9, 'book-1');
    expect(mockGtag).toHaveBeenCalledWith('event', 'nps_submitted', { score: 9, booking_id: 'book-1' });
  });

  test('trackNpsSubmitted without bookingId', () => {
    trackNpsSubmitted(7);
    expect(mockGtag).toHaveBeenCalledWith('event', 'nps_submitted', { score: 7 });
  });

  test('no gtag → functions silently do nothing', () => {
    delete (window as Window & { gtag?: jest.Mock }).gtag;
    expect(() => trackBookingStarted('fac-1', 'Salon')).not.toThrow();
    expect(mockGtag).not.toHaveBeenCalled();
  });
});
