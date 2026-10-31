// The Vercel-only endpoint does not exist on Workers. Cloudflare monitoring
// must be explicitly selected and configured before a real migration.
export function SpeedInsights() { return null; }
