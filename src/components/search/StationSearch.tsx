'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function StationSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stations, setStations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/stations', { signal: AbortSignal.timeout(10000) })
      .then((r) => r.json())
      .then((data) => setStations(data.stations || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  const filtered = query
    ? stations.filter((s) => s.includes(query))
    : stations;

  const handleSelect = (station: string) => {
    setOpen(false);
    router.push(`/search?keyword=${encodeURIComponent(station)}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
        駅から探す
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">駅から探す</h3>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl" aria-label="閉じる">&times;</button>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="駅名を入力..."
                className="form-input w-full text-sm"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {loading ? (
                <p className="text-center text-gray-400 text-sm py-8">読み込み中...</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">該当する駅がありません</p>
              ) : (
                filtered.map((station) => (
                  <button
                    key={station}
                    onClick={() => handleSelect(station)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-sky-50 transition-colors"
                  >
                    {station}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
