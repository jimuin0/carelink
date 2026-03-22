'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function ViewCount({ facilityId }: { facilityId: string }) {
  useEffect(() => {
    const key = `viewed_${facilityId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const supabase = createBrowserSupabaseClient();
    void supabase.rpc('increment_view_count', { facility_uuid: facilityId });
  }, [facilityId]);

  return null;
}
