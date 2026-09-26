'use client';

import { useEffect } from 'react';

export const TRAFFIC_SOURCE_STORAGE_KEY = 'carelink-traffic-source-v1';

export type TrafficSourceData = {
  source: string;
  medium: string | null;
  referrerHost: string | null;
  landingPath: string;
  capturedAt: string;
};

function cleanValue(value: string | null): string | null {
  if (!value) return null;

  const cleaned = value.trim().toLowerCase();

  if (!/^[a-z0-9._-]{1,100}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function detectSourceFromReferrer(referrer: string): {
  source: string;
  medium: string | null;
  referrerHost: string | null;
} {
  if (!referrer) {
    return {
      source: 'unknown',
      medium: null,
      referrerHost: null,
    };
  }

  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();

    if (host === 'threads.net' || host.endsWith('.threads.net')) {
      return {
        source: 'threads',
        medium: 'social',
        referrerHost: host,
      };
    }

    if (
      host === 'instagram.com' ||
      host.endsWith('.instagram.com')
    ) {
      return {
        source: 'instagram',
        medium: 'social',
        referrerHost: host,
      };
    }

    if (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'google.co.jp' ||
      host.endsWith('.google.co.jp')
    ) {
      return {
        source: 'google',
        medium: 'organic',
        referrerHost: host,
      };
    }

    return {
      source: host,
      medium: 'referral',
      referrerHost: host,
    };
  } catch {
    return {
      source: 'unknown',
      medium: null,
      referrerHost: null,
    };
  }
}

export default function TrafficSourceTracker() {
  useEffect(() => {
    try {
      // このタブですでに流入元を取得済みなら上書きしない
      const existing = sessionStorage.getItem(TRAFFIC_SOURCE_STORAGE_KEY);

      if (existing) {
        return;
      }

      const params = new URLSearchParams(window.location.search);

      const utmSource = cleanValue(params.get('utm_source'));
      const utmMedium = cleanValue(params.get('utm_medium'));

      const referrerData = detectSourceFromReferrer(document.referrer);

      const trafficData: TrafficSourceData = {
        source: utmSource ?? referrerData.source,
        medium: utmSource
          ? utmMedium
          : referrerData.medium,
        referrerHost: referrerData.referrerHost,
        landingPath: window.location.pathname,
        capturedAt: new Date().toISOString(),
      };

      sessionStorage.setItem(
        TRAFFIC_SOURCE_STORAGE_KEY,
        JSON.stringify(trafficData),
      );
    } catch {
      // 流入元の取得に失敗してもサイト自体には影響させない
    }
  }, []);

  return null;
}
