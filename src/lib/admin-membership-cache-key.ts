/** Cookie identity shared by middleware and membership-changing API responses. */
export function getMembershipCacheKey(userId: string): string {
  // The full user ID is still bound into the signed payload by middleware.
  return `_cm_mbr_${userId.replace(/-/g, '').slice(0, 16)}`;
}
