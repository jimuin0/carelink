'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { analytics } from '@/lib/analytics';
import { verifyAuthUser } from '@/lib/auth-verification';
import { readAuthorization } from '@/lib/authorization-read';

export default function FavoriteButton({ facilityId }: { facilityId: string }) {
  return <FacilityFavoriteButton key={facilityId} facilityId={facilityId} />;
}

function FacilityFavoriteButton({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    inFlight.current = false;
    const checkStatus = async () => {
      const supabase = createBrowserSupabaseClient();
      const identity = await verifyAuthUser(supabase.auth);

      if (!active) return;
      if (identity.state === 'unavailable') throw new Error('Favorite identity unavailable');
      if (identity.state === 'unauthenticated') {
        setIsLoggedIn(false);
        setPending(false);
        setLoading(false);
        return;
      }

      setIsLoggedIn(true);

      // An unavailable read is not evidence of an absent favorite.
      const { data, error } = await readAuthorization(supabase
        .from('favorites').select('id')
        .eq('user_id', identity.user.id).eq('facility_id', facilityId).maybeSingle());
      if (!active) return;
      if (error || (data !== null && (typeof data !== 'object' || typeof data.id !== 'string'))) throw new Error('Favorite state unavailable');
      setIsFavorited(!!data);
      setPending(false);
      setLoading(false);
    };
    checkStatus().catch(() => { if (active) { setUnavailable(true); setPending(false); setLoading(false); } });
    return () => { active = false; generation.current += 1; };
  }, [facilityId]);

  const handleToggle = async () => {
    if (inFlight.current) return;
    if (!isLoggedIn) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }

    const epoch = generation.current;
    inFlight.current = true;
    setPending(true);
    const previousState = isFavorited;
    setIsFavorited(!previousState);

    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, isFavorited: !previousState }),
        signal: AbortSignal.timeout(10000),
      });

      if (generation.current !== epoch) return;
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (generation.current !== epoch) return;
        if (typeof body?.isFavorited !== 'boolean' || body.isFavorited !== !previousState) throw new Error('Unconfirmed favorite result');
        const newState = body.isFavorited;
        setIsFavorited(newState);
        try { analytics.favoriteToggled(facilityId, newState ? 'add' : 'remove'); } catch { /* Optional telemetry cannot undo a confirmed mutation. */ }
      } else {
        setIsFavorited(previousState);
      }
    } catch {
      if (generation.current === epoch) setIsFavorited(previousState);
    } finally {
      if (generation.current === epoch) { inFlight.current = false; setPending(false); }
    }
  };

  if (loading || unavailable) {
    return (
      <button type="button" className="p-2 min-h-[44px] min-w-[44px]" disabled aria-label={unavailable ? 'お気に入り状態を確認できません' : '読み込み中'} title={unavailable ? 'ページを再読み込みして状態を確認してください' : undefined}>
        <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-busy={pending}
      className="p-2 min-h-[44px] min-w-[44px] transition-transform active:scale-90"
      aria-label={isFavorited ? 'お気に入りから削除' : 'お気に入りに追加'}
    >
      <svg
        className={`w-6 h-6 transition-colors ${isFavorited ? 'text-pink-500 fill-pink-500' : 'text-gray-400'}`}
        fill={isFavorited ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    </button>
  );
}
