'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { prefectures } from '@/lib/constants';
import { analytics } from '@/lib/analytics';
import SearchSuggest from './SearchSuggest';
import StationSearch from './StationSearch';

export default function HomeSearchForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [area, setArea] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (area) params.set('area', area);
    analytics.searchPerformed(keyword.trim() || area || 'all');
    router.push(`/search?${params.toString()}`);
  };

  const handleGeoSearch = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        router.push(`/search?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      },
      () => setGeoLoading(false),
      { timeout: 10000 }
    );
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex bg-white rounded shadow-sm overflow-hidden" role="search" aria-label="サロン検索">
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          aria-label="エリアを選択"
          className="w-[120px] px-3 py-2.5 text-xs text-gray-600 bg-transparent border-r border-gray-100 focus:outline-none appearance-none"
        >
          <option value="">全エリア</option>
          {prefectures.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="relative flex-1">
          <input
            type="text"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            placeholder="サロン名・キーワード"
            aria-label="サロン名・キーワードで検索"
            className="w-full px-4 py-2.5 text-sm text-gray-700 bg-transparent focus:outline-none placeholder:text-gray-400"
          />
          <SearchSuggest
            query={keyword}
            onSelect={(v) => setKeyword(v)}
            visible={suggestOpen}
            onClose={() => setSuggestOpen(false)}
          />
        </div>
        <button type="submit" className="px-6 py-2.5 bg-sky-700 text-white text-xs tracking-wider hover:bg-sky-800 transition-colors whitespace-nowrap">
          検索
        </button>
      </form>
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleGeoSearch}
          disabled={geoLoading}
          className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {geoLoading ? '取得中...' : '現在地から探す'}
        </button>
        <StationSearch />
      </div>
    </div>
  );
}
