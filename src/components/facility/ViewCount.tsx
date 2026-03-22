'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function ViewCount({ facilityId }: { facilityId: string }) {
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.rpc('increment_view_count', { facility_uuid: facilityId }).then(() => {});
  }, [facilityId]);

  return null;
}
