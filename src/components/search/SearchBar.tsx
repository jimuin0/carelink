'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { businessTypes, prefectures } from '@/lib/constants';
import SearchSuggest from './SearchSuggest';

const HISTORY_KEY = 'carelink_search_history';
const MAX_HISTORY = 5;

function getSearchHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function addSearchHistory(term: string) {
  if (!term.trim()) return;
  try {
    const history = getSearchHistory().filter((h) => h !== term.trim());
    history.unshift(term.trim());
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* storage full or private browsing */ }
}

export default function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [prefecture, setPrefecture] = useState(searchParams.get('area') || '');
  const [history, setHistory] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  useEffect(() => { setHistory(getSearchHistory()); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) addSearchHistory(keyword.trim());
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (type) params.set('type', type);
    if (prefecture) params.set('area', prefecture);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="relative sm:col-span-2">
          <input
            type="search"
            name="keyword"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            placeholder="キーワード（店名・エリアなど）"
            className="form-input w-full"
            autoComplete="off"
          />
          <SearchSuggest
            query={keyword}
            onSelect={(v) => setKeyword(v)}
            visible={suggestOpen}
            onClose={() => setSuggestOpen(false)}
          />
        </div>
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="form-input"
          aria-label="業種を選択"
        >
          <option value="">すべての業種</option>
          {businessTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          name="area"
          value={prefecture}
          onChange={(e) => setPrefecture(e.target.value)}
          className="form-input"
          aria-label="エリアを選択"
        >
          <option value="">すべてのエリア</option>
          {prefectures.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary w-full mt-3 !py-3">
        検索する
      </button>
      {history.length > 0 && !keyword && (
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs text-gray-400">最近の検索:</span>
          {history.map((h) => (
            <button key={h} type="button" onClick={() => { setKeyword(h); }} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full hover:bg-gray-200">
              {h}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
