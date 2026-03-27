'use client';

import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface ViewedFacility {
  id: string;
  name: string;
  slug: string;
  photo_url: string | null;
  business_type: string;
  ts: number;
}

export function saveViewedFacility(facility: Omit<ViewedFacility, 'ts'>) {
  try {
    const key = 'viewed_facilities';
    const raw = localStorage.getItem(key);
    const list: ViewedFacility[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((f) => f.id !== facility.id);
    filtered.unshift({ ...facility, ts: Date.now() });
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 20)));
  } catch { /* ignore */ }
}

export function getViewedFacilities(): ViewedFacility[] {
  try {
    const raw = localStorage.getItem('viewed_facilities');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function ViewCount({ facilityId, facilityName, facilitySlug, mainPhotoUrl, businessType }: {
  facilityId: string;
  facilityName?: string;
  facilitySlug?: string;
  mainPhotoUrl?: string | null;
  businessType?: string;
}) {
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

    // Save to viewed history
    if (facilityName && facilitySlug) {
      saveViewedFacility({
        id: facilityId,
        name: facilityName,
        slug: facilitySlug,
        photo_url: mainPhotoUrl ?? null,
        business_type: businessType ?? '',
      });
    }
  }, [facilityId, facilityName, facilitySlug, mainPhotoUrl, businessType]);

  return null;
}
