import { createClient } from '@supabase/supabase-js';

// Anonymous client for public data reads only (no cookie/auth context).
// Do NOT use for write operations or user-specific data.
// For authenticated operations, use createServerSupabaseAuthClient from supabase-server-auth.ts.
export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
