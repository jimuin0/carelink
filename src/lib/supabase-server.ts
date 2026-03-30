import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
}

// Anonymous client for public data reads only (no cookie/auth context).
// Do NOT use for write operations or user-specific data.
export function createServerSupabaseClient() {
  return createClient(supabaseUrl!, supabaseAnonKey!);
}

// Service role client for server-side operations that bypass RLS.
// Only use in trusted server contexts (API routes, cron jobs).
export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service role client');
  }
  return createClient(supabaseUrl!, serviceRoleKey);
}
