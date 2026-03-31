'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { FacilityCardData } from '@/types';
import FacilityCard from './FacilityCard';

const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: () => <div className="h-[500px] bg-gray-100 rounded-2xl animate-pulse" /> });

interface Props {
  facilities: FacilityCardData[];
  bookingCounts?: Record<string, number>;
  availableIds?: string[];
}

export default function ViewToggle({ facilities, bookingCounts, availableIds }: Props) {
  const [view, setView] = useState<'list' | 'map'>('list');

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => setView('list')}
          aria-label="リスト表示"
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'list' ? 'bg-white text-gray-900 font-bold shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          リスト
        </button>
        <button
          type="button"
          onClick={() => setView('map')}
          aria-label="マップ表示"
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${view === 'map' ? 'bg-white text-gray-900 font-bold shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          マップ
        </button>
        </div>
      </div>

      {view === 'map' ? (
        <MapView facilities={facilities} />
      ) : (
        facilities.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-6">
            {facilities.map((f) => (<FacilityCard key={f.id} facility={f} monthlyBookings={bookingCounts?.[f.id]} isAvailable={availableIds ? availableIds.includes(f.id) : undefined} />))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
            <p className="text-gray-500 text-lg mb-2">該当するサロン・クリニックが見つかりませんでした</p>
            <p className="text-gray-500 text-sm">条件を変えて再度お試しください</p>
          </div>
        )
      )}
    </div>
  );
}
