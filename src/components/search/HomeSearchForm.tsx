'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomeSearchForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-0 max-w-xl">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="サロン名・キーワードから探す"
        className="flex-1 px-4 py-2.5 text-gray-800 text-sm rounded-l border-0 focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <button type="submit" className="px-6 py-2.5 bg-gray-800 text-white text-sm font-bold rounded-r hover:bg-gray-700 transition-colors whitespace-nowrap">
        検索
      </button>
    </form>
  );
}
