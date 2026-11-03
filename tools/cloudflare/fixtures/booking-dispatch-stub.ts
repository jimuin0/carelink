// Local synthetic-booking tests only. Never included in a production build.
export async function dispatchBookingCreationNotifications(_operationId: string) {
  return { accepted: 0, pending: 0, uncertain: 0, skipped: 0 };
}
