import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';

// These data clients have no user session to refresh. Without this, each
// short-lived client starts an unref'ed Auth interval that survives the request
// in a warm container. Cookie-based user authentication has its own client.
const statelessOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

// Anonymous client for public data reads only (no cookie/auth context).
// Do NOT use for write operations or user-specific data.
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
  }
  return createClient<Database>(url, key, statelessOptions);
}

// Service role client for server-side operations that bypass RLS.
// Only use in trusted server contexts (API routes, cron jobs).
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient<Database>(url, serviceRoleKey, statelessOptions);
}
