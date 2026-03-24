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
    <form onSubmit={handleSubmit} className="flex bg-white rounded shadow-sm overflow-hidden">
      <select
        value={area}
        onChange={(e) => setArea(e.target.value)}
        className="w-[120px] px-3 py-2.5 text-xs text-gray-500 bg-transparent border-r border-gray-100 focus:outline-none appearance-none"
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
        className="flex-1 px-4 py-2.5 text-sm text-gray-700 bg-transparent focus:outline-none placeholder:text-gray-300"
      />
      <button type="submit" className="px-6 py-2.5 bg-[#b5a898] text-white text-xs tracking-wider hover:bg-[#a49787] transition-colors whitespace-nowrap">
        検索
      </button>
    </form>
  );
}
