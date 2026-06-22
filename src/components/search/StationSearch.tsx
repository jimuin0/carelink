'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function StationSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [stations, setStations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1); // combobox の現在ハイライト位置
  const router = useRouter();

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFetchError(false);
    fetch('/api/stations', { signal: AbortSignal.timeout(10000) })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => setStations(data.stations || []))
      .catch(() => setFetchError(true))
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

  // combobox キーボード操作（上下で候補移動・Enter で確定）
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < filtered.length) {
      e.preventDefault();
      handleSelect(filtered[activeIndex]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 min-h-[24px] text-xs text-white font-medium hover:text-sky-100 transition-colors [text-shadow:0_1px_3px_rgba(0,0,0,0.3)]"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
        駅から探す
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="駅から探す"
            className="bg-white rounded-2xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">駅から探す</h3>
                <button type="button" onClick={() => setOpen(false)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center -mr-2 text-gray-400 hover:text-gray-600 text-xl" aria-label="閉じる">&times;</button>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
                onKeyDown={handleInputKeyDown}
                placeholder="駅名を入力..."
                className="form-input w-full text-sm"
                maxLength={50}
                autoFocus
                role="combobox"
                aria-label="駅名で検索"
                aria-expanded={filtered.length > 0}
                aria-controls="station-listbox"
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? `station-opt-${activeIndex}` : undefined}
              />
            </div>
            <div id="station-listbox" role="listbox" aria-label="駅候補" className="overflow-y-auto flex-1 p-2">
              {loading ? (
                <p className="text-center text-gray-400 text-sm py-8">読み込み中...</p>
              ) : fetchError ? (
                <p className="text-center text-gray-400 text-sm py-8">駅情報の読み込みに失敗しました</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">該当する駅がありません</p>
              ) : (
                filtered.map((station, i) => (
                  <button
                    type="button"
                    key={station}
                    id={`station-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onClick={() => handleSelect(station)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${i === activeIndex ? 'bg-sky-100' : 'hover:bg-sky-50'}`}
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
