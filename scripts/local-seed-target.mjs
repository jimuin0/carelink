// Seed helpers are for an explicitly selected disposable local Supabase only.
// Validate before creating a client, reading rows or making any network request.
export function requireDisposableSeedTarget(env = process.env, args = process.argv.slice(2)) {
  let target;
  try { target = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { throw new Error('SEED_LOCAL_TARGET_REQUIRED'); }
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)
    || target.port !== '54321' || target.username || target.password || target.search || target.hash
    || target.pathname !== '/' || env.CARELINK_DISPOSABLE_SUPABASE_URL !== target.origin
    || args.length !== 1 || args[0] !== '--local-test-data') {
    throw new Error('SEED_LOCAL_TARGET_REQUIRED');
  }
  return target.origin;
}
