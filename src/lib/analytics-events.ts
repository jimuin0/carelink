/**
 * カスタムイベントトラッキング (GA4 / gtag)
 * 主要ユーザーアクションを型安全に追跡する
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

function track(eventName: string, params?: Record<string, string | number | boolean>) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}

// 予約
export function trackBookingStarted(facilityId: string, facilityName: string) {
  track('booking_started', { facility_id: facilityId, facility_name: facilityName });
}

export function trackBookingCompleted(facilityId: string, facilityName: string, menuName?: string, price?: number) {
  track('booking_completed', {
    facility_id: facilityId,
    facility_name: facilityName,
    ...(menuName && { menu_name: menuName }),
    ...(price !== undefined && { value: price, currency: 'JPY' }),
  });
}

export function trackBookingCancelled(bookingId: string, reason?: string) {
  track('booking_cancelled', { booking_id: bookingId, ...(reason && { reason }) });
}

// 検索
export function trackSearch(query: string, type?: string, prefecture?: string, resultCount?: number) {
  track('search', {
    search_term: query,
    ...(type && { content_type: type }),
    ...(prefecture && { prefecture }),
    ...(resultCount !== undefined && { result_count: resultCount }),
  });
}

// 施設
export function trackFacilityViewed(facilityId: string, facilityName: string, businessType: string) {
  track('facility_viewed', { facility_id: facilityId, facility_name: facilityName, business_type: businessType });
}

export function trackPhoneClicked(facilityId: string) {
  track('phone_clicked', { facility_id: facilityId });
}

// レビュー
export function trackReviewStarted(facilityId: string) {
  track('review_started', { facility_id: facilityId });
}

export function trackReviewSubmitted(facilityId: string, rating: number) {
  track('review_submitted', { facility_id: facilityId, rating });
}

// お気に入り
export function trackFavoriteAdded(facilityId: string) {
  track('favorite_added', { facility_id: facilityId });
}

export function trackFavoriteRemoved(facilityId: string) {
  track('favorite_removed', { facility_id: facilityId });
}

// クーポン
export function trackCouponViewed(couponId: string, discount: number) {
  track('coupon_viewed', { coupon_id: couponId, discount_value: discount });
}

export function trackCouponRedeemed(couponId: string, facilityId: string) {
  track('coupon_redeemed', { coupon_id: couponId, facility_id: facilityId });
}

// 回数券/サブスク
export function trackPackagePurchased(packageId: string, packageName: string, price: number) {
  track('package_purchased', { package_id: packageId, package_name: packageName, value: price, currency: 'JPY' });
}

export function trackSubscriptionStarted(planId: string, planName: string, price: number) {
  track('subscription_started', { plan_id: planId, plan_name: planName, value: price, currency: 'JPY' });
}

// 会員登録/ログイン
export function trackSignUp(method: string) {
  track('sign_up', { method });
}

export function trackLogin(method: string) {
  track('login', { method });
}

// シェア
export function trackShare(contentType: string, contentId: string, method: string) {
  track('share', { content_type: contentType, item_id: contentId, method });
}

// 症状チェッカー
export function trackSymptomChecked(symptoms: string, resultCount: number) {
  track('symptom_checked', { symptoms: symptoms.slice(0, 100), result_count: resultCount });
}

// NPS
export function trackNpsSubmitted(score: number, bookingId?: string) {
  track('nps_submitted', { score, ...(bookingId && { booking_id: bookingId }) });
}
