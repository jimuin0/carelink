'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function ViewCount({ facilityId }: { facilityId: string }) {
  useEffect(() => {
    try {
      const key = `viewed_${facilityId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage unavailable (e.g. Safari private browsing)
    }
    const supabase = createBrowserSupabaseClient();
    void supabase.rpc('increment_view_count', { facility_uuid: facilityId });
  }, [facilityId]);

  return null;
}
