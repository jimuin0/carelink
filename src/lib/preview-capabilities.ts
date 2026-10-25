/** Missing private capabilities are intentional in public read-only previews.
 * Production must continue to fail closed when its required secrets are absent.
 */
export function isPublicReadOnlyPreview(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}
