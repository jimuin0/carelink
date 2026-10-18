'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { analytics } from '@/lib/analytics';

export default function FavoriteButton({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const currentFacility = useRef<string | null>(facilityId);

  useEffect(() => {
    let active = true;
    currentFacility.current = facilityId;
    inFlight.current = false;
    const checkStatus = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        setIsLoggedIn(false);
        setPending(false);
        setLoading(false);
        return;
      }

      setIsLoggedIn(true);

      // お気に入り状態の初期判定（補助）。失敗時は未登録表示にフォールバックし、
      // トグルはサーバ権威の /api/favorites 応答で正しい状態に補正されるため致命的でない。
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('facility_id', facilityId)
        .maybeSingle();

      if (!active) return;
      setIsFavorited(!!data);
      setPending(false);
      setLoading(false);
    };
    checkStatus().catch(() => { if (active) { setPending(false); setLoading(false); } });
    return () => { active = false; currentFacility.current = null; };
  }, [facilityId]);

  const handleToggle = async () => {
    if (inFlight.current) return;
    if (!isLoggedIn) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }

    inFlight.current = true;
    setPending(true);
    const previousState = isFavorited;
    setIsFavorited(!previousState);

    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId }),
        signal: AbortSignal.timeout(10000),
      });

      if (currentFacility.current !== facilityId) return;
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (typeof body?.isFavorited !== 'boolean') throw new Error('Unconfirmed favorite result');
        const newState = body.isFavorited;
        setIsFavorited(newState);
        analytics.favoriteToggled(facilityId, newState ? 'add' : 'remove');
      } else {
        setIsFavorited(previousState);
      }
    } catch {
      if (currentFacility.current === facilityId) setIsFavorited(previousState);
    } finally {
      if (currentFacility.current === facilityId) { inFlight.current = false; setPending(false); }
    }
  };

  if (loading) {
    return (
      <button type="button" className="p-2 min-h-[44px] min-w-[44px]" disabled aria-label="読み込み中">
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
