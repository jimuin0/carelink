'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function FavoriteButton({ facilityId }: { facilityId: string }) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setIsLoggedIn(true);

      const { data } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('facility_id', facilityId)
        .single();

      setIsFavorited(!!data);
      setLoading(false);
    };
    checkStatus().catch(() => setLoading(false));
  }, [facilityId]);

  const handleToggle = async () => {
    if (!isLoggedIn) {
      window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setIsFavorited(!isFavorited);

    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    });

    if (res.ok) {
      const { isFavorited: newState } = await res.json();
      setIsFavorited(newState);
    } else {
      setIsFavorited(isFavorited);
    }
  };

  if (loading) {
    return (
      <button className="p-2 min-h-[44px] min-w-[44px]" disabled aria-label="読み込み中">
        <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
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
