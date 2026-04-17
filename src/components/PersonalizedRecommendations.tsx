'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { SHIMMER_BLUR, cardUrl } from '@/lib/image-utils';
import type { FacilityCardData } from '@/types';

interface RecommendResult {
  recommendations: FacilityCardData[];
  type: 'personalized' | 'popular';
  based_on?: { business_type?: string; prefecture?: string; city?: string };
}

export default function PersonalizedRecommendations() {
  const [result, setResult] = useState<RecommendResult | null>(null);

  useEffect(() => {
    fetch('/api/recommendations?limit=4')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.recommendations?.length) setResult(data); })
      .catch(() => null);
  }, []);

  if (!result || result.recommendations.length === 0) return null;

  const isPersonalized = result.type === 'personalized';
  const label = isPersonalized
    ? `${result.based_on?.business_type ?? ''}のおすすめ施設`
    : '人気の施設';

  return (
    <section className="py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span>{isPersonalized ? '✨' : '🔥'}</span>
          {label}
          {isPersonalized && result.based_on?.prefecture && (
            <span className="text-sm font-normal text-gray-500">({result.based_on.prefecture})</span>
          )}
        </h2>
        <Link href="/search" className="text-sm text-sky-600 hover:underline">もっと見る</Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {result.recommendations.map((facility) => (
          <Link key={facility.id} href={`/facility/${facility.slug}`}
            className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-md transition-shadow">
            <div className="relative aspect-[16/10] bg-gray-100">
              {facility.main_photo_url ? (
                <Image
                  src={cardUrl(facility.main_photo_url)}
                  alt={facility.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover"
                  placeholder="blur"
                  blurDataURL={SHIMMER_BLUR}
                />
              ) : (
                <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-50 to-indigo-50">
                  <span className="text-2xl font-bold text-sky-300">{facility.name.charAt(0)}</span>
                </div>
              )}
              <span className="absolute top-2 left-2 bg-white/90 text-xs px-2 py-0.5 rounded-full text-gray-700 font-medium">
                {facility.business_type}
              </span>
            </div>
            <div className="p-3">
              <p className="font-bold text-sm text-gray-800 line-clamp-1">{facility.name}</p>
              {facility.rating_count > 0 && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-amber-400 text-xs">★</span>
                  <span className="text-xs font-bold text-gray-700">{Number(facility.rating_avg).toFixed(1)}</span>
                  <span className="text-xs text-gray-400">({facility.rating_count}件)</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{facility.prefecture} {facility.city}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
