/** Reload the authenticated server layout after the first membership is created. */
export function navigateAfterFacilitySetup(facilityId?: string): void {
  window.location.replace(facilityId ? `/admin?facility_id=${encodeURIComponent(facilityId)}` : '/admin');
}
