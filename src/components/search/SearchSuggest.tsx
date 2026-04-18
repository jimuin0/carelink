'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { FacilitySuggestion } from '@/types';

interface Props {
  query: string;
  onSelect: (value: string) => void;
  visible: boolean;
  onClose: () => void;
}

interface SuggestResult {
  facilities: FacilitySuggestion[];
  areas: string[];
}

export default function SearchSuggest({ query, onSelect, visible, onClose }: Props) {
  const [results, setResults] = useState<SuggestResult>({ facilities: [], areas: [] });
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults({ facilities: [], areas: [] });
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(() => {
      fetch(`/api/facilities/suggest?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((data) => { if (!controller.signal.aborted) setResults(data); })
        .catch((err) => { if (err.name !== 'AbortError') setResults({ facilities: [], areas: [] }); });
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      controller.abort();
    };
  }, [query]);

  const hasResults = results.facilities.length > 0 || results.areas.length > 0;
  if (!visible || !hasResults) return null;

  return (
    <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 overflow-hidden max-h-80 overflow-y-auto">
      {results.facilities.length > 0 && (
        <div>
          <p className="px-3 py-1.5 text-micro text-gray-400 font-bold bg-gray-50">サロン・クリニック</p>
          {results.facilities.map((f) => (
            <button
              key={f.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onClose();
                router.push(`/facility/${f.slug}`);
              }}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors flex items-center gap-2"
            >
              <span className="text-sm font-medium truncate flex-1">{f.name}</span>
              <span className="text-micro text-gray-400 shrink-0">{f.city}{f.nearest_station ? ` / ${f.nearest_station}` : ''}</span>
              <span className="text-micro text-sky-500 shrink-0">{f.business_type}</span>
            </button>
          ))}
        </div>
      )}
      {results.areas.length > 0 && (
        <div>
          <p className="px-3 py-1.5 text-micro text-gray-400 font-bold bg-gray-50">エリア・駅</p>
          {results.areas.map((area) => (
            <button
              key={area}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(area);
                onClose();
              }}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-sm">{area}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
