'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useCallback } from 'react';
import { businessTypes, facilityFeatures, regionGroups } from '@/lib/constants';

export default function SearchFilters({ className }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [area, setArea] = useState(searchParams.get('area') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [ratingMin, setRatingMin] = useState(searchParams.get('rating_min') || '');
  const [priceMin, setPriceMin] = useState(searchParams.get('price_min') || '');
  const [priceMax, setPriceMax] = useState(searchParams.get('price_max') || '');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(
    searchParams.get('features')?.split(',').filter(Boolean) || []
  );
  const [availableDate, setAvailableDate] = useState(searchParams.get('available_date') || '');
  const [availableTime, setAvailableTime] = useState(searchParams.get('available_time') || '');

  const toggleFeature = useCallback((feature: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  }, []);

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    const keyword = searchParams.get('keyword');
    if (keyword) params.set('keyword', keyword);
    if (area) params.set('area', area);
    if (type) params.set('type', type);
    if (ratingMin) params.set('rating_min', ratingMin);
    if (priceMin) params.set('price_min', priceMin);
    if (priceMax) params.set('price_max', priceMax);
    if (selectedFeatures.length > 0) params.set('features', selectedFeatures.join(','));
    if (availableDate) params.set('available_date', availableDate);
    if (availableTime) params.set('available_time', availableTime);
    const sort = searchParams.get('sort');
    if (sort) params.set('sort', sort);
    router.push(`/search?${params.toString()}`);
  }, [router, searchParams, area, type, ratingMin, priceMin, priceMax, selectedFeatures, availableDate, availableTime]);

  const clearFilters = useCallback(() => {
    const keyword = searchParams.get('keyword');
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    router.push(`/search?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-gray-800">絞り込み</h2>
        <button onClick={clearFilters} aria-label="フィルターをクリア" className="text-xs text-gray-400 hover:text-sky-600 transition-colors">
          クリア
        </button>
      </div>

      {/* エリア */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">エリア</label>
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          aria-label="エリアを選択"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="">すべて</option>
          {regionGroups.map((region) => (
            <optgroup key={region.name} label={region.name}>
              {region.prefectures.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* 業種 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">業種</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="業種を選択"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="">すべて</option>
          {businessTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* 評価 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">評価</label>
        <div className="space-y-1.5">
          {[
            { value: '', label: 'すべて' },
            { value: '4', label: '★4.0 以上' },
            { value: '3.5', label: '★3.5 以上' },
            { value: '3', label: '★3.0 以上' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="rating_min"
                value={opt.value}
                checked={ratingMin === opt.value}
                onChange={(e) => setRatingMin(e.target.value)}
                className="accent-sky-500"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 価格帯 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">価格帯</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="¥ 下限"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            min={0}
            step={1000}
          />
          <span className="text-gray-400 text-xs">〜</span>
          <input
            type="number"
            placeholder="¥ 上限"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            min={0}
            step={1000}
          />
        </div>
      </div>

      {/* 日付・時間指定 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">予約希望日</label>
        <input
          type="date"
          value={availableDate}
          onChange={(e) => setAvailableDate(e.target.value)}
          min={new Date().toISOString().slice(0, 10)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
      </div>
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">時間帯</label>
        <select
          value={availableTime}
          onChange={(e) => setAvailableTime(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="">指定なし</option>
          <option value="morning">午前（9:00〜12:00）</option>
          <option value="afternoon">午後（12:00〜17:00）</option>
          <option value="evening">夕方以降（17:00〜）</option>
        </select>
      </div>

      {/* こだわり条件 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">こだわり条件</label>
        <div className="flex flex-wrap gap-1.5">
          {facilityFeatures.map((feature) => {
            const isSelected = selectedFeatures.includes(feature);
            return (
              <button
                key={feature}
                onClick={() => toggleFeature(feature)}
                aria-pressed={isSelected}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                  isSelected
                    ? 'bg-sky-100 text-sky-700 border border-sky-200 font-medium'
                    : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {feature}
              </button>
            );
          })}
        </div>
      </div>

      {/* 適用ボタン */}
      <button
        onClick={applyFilters}
        className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold rounded-lg transition-colors"
      >
        この条件で検索
      </button>
    </div>
  );
}
