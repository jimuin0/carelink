declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function trackEvent(action: string, params?: Record<string, string | number>) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', action, params);
  }
}

export const analytics = {
  searchPerformed: (keyword: string) => trackEvent('search', { search_term: keyword }),
  facilityViewed: (slug: string, type: string) => trackEvent('facility_view', { facility_slug: slug, business_type: type }),
  bookingClicked: (facilitySlug: string) => trackEvent('booking_click', { facility_slug: facilitySlug }),
  phoneClicked: (facilitySlug: string) => trackEvent('phone_click', { facility_slug: facilitySlug }),
  favoriteToggled: (facilityId: string, action: 'add' | 'remove') => trackEvent('favorite_toggle', { facility_id: facilityId, action }),
  couponViewed: (couponId: string) => trackEvent('coupon_view', { coupon_id: couponId }),
  inquirySubmitted: (facilityId: string) => trackEvent('inquiry_submit', { facility_id: facilityId }),
  filterApplied: (filterType: string) => trackEvent('filter_applied', { filter_type: filterType }),
};
