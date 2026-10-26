// The Vercel-only collector is unavailable on Cloudflare. Keep production's
// component unchanged and emit no script or network request in this build.
export function SpeedInsights() {
  return null;
}
