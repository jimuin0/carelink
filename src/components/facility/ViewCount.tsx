'use client';

import { useEffect } from 'react';
import { VIEWED_FACILITIES_KEY } from '@/lib/client-storage';

interface ViewedFacility {
  id: string;
  name: string;
  slug: string;
  photo_url: string | null;
  business_type: string;
  ts: number;
}

export function saveViewedFacility(facility: Omit<ViewedFacility, 'ts'>) {
  if (typeof window === 'undefined') return;
  try {
    const key = VIEWED_FACILITIES_KEY;
    const raw = localStorage.getItem(key);
    const list = parseViewedFacilities(raw);
    const filtered = list.filter((f) => f.id !== facility.id);
    filtered.unshift({ ...facility, ts: Date.now() });
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 20)));
  } catch { /* ignore */ }
}

// 監査 A402: 端末に残った値は壊れていたり古い形だったりする。配列でない・項目の形が違うものは捨てる
// （そのまま返すと RecentlyViewed が facilities.slice で落ちていた）。
function parseViewedFacilities(raw: string | null): ViewedFacility[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((f): f is ViewedFacility => !!f && typeof f === 'object'
    && typeof (f as ViewedFacility).id === 'string'
    && typeof (f as ViewedFacility).name === 'string'
    && typeof (f as ViewedFacility).slug === 'string');
}

export function getViewedFacilities(): ViewedFacility[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseViewedFacilities(localStorage.getItem(VIEWED_FACILITIES_KEY));
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
    // 監査 A401: 閲覧数の重複加算だけを止め、「最近見た施設」の並び順の更新は再訪でも行う。
    let alreadyCounted = false;
    try {
      const key = `viewed_${facilityId}`;
      if (sessionStorage.getItem(key)) alreadyCounted = true;
      else sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage unavailable (e.g. Safari private browsing)
    }
    // 累積 view_count の加算＋時系列行(facility_page_views)の記録を一括で行う。
    // 後者は admin/funnel の期間窓ファネル「ページ閲覧」集計に使う。
    // サーバー側で公開状態の確認と回数制限をしてから記録する（ブラウザから RPC を直接呼ばない）。
    if (!alreadyCounted) {
      void fetch(`/api/facilities/${encodeURIComponent(facilityId)}/view`, { method: 'POST', keepalive: true }).catch(() => undefined);
    }

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
