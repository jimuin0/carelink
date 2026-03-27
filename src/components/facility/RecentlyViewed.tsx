'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getViewedFacilities } from './ViewCount';

export default function RecentlyViewed() {
  const [facilities, setFacilities] = useState<ReturnType<typeof getViewedFacilities>>([]);

  useEffect(() => {
    setFacilities(getViewedFacilities());
  }, []);

  if (facilities.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <h2 className="font-bold mb-3">最近見た施設</h2>
      <div className="space-y-2">
        {facilities.slice(0, 5).map((f) => (
          <Link key={f.id} href={`/facility/${f.slug}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
              {f.photo_url ? (
                <Image src={f.photo_url} alt={f.name} width={48} height={48} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{f.name}</p>
              <p className="text-xs text-gray-400">{f.business_type}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
