'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { prefectures } from '@/lib/constants';

export default function HomeSearchForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [area, setArea] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (area) params.set('area', area);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex">
      <select
        value={area}
        onChange={(e) => setArea(e.target.value)}
        className="w-[130px] px-2 py-1.5 border border-gray-300 border-r-0 text-xs text-gray-700 bg-white focus:outline-none appearance-none"
      >
        <option value="">全エリア</option>
        {prefectures.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="サロン名・キーワード"
        className="flex-1 px-3 py-1.5 border border-gray-300 border-r-0 text-sm text-gray-800 focus:outline-none"
      />
      <button type="submit" className="px-5 py-1.5 bg-gray-100 border border-gray-300 text-sm text-gray-700 hover:bg-gray-200 transition-colors whitespace-nowrap">
        検索
      </button>
    </form>
  );
}
