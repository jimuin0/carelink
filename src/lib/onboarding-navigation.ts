/** Reload the authenticated server layout after the first membership is created. */
export function navigateAfterFacilitySetup(): void {
  window.location.replace('/admin');
}
