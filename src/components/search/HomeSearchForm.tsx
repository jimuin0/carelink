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
    <form onSubmit={handleSubmit} className="flex gap-2 mt-3">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="サロン名から探す"
        className="flex-1 px-4 py-2.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-primary"
      />
      <button type="submit" className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded hover:bg-sky-600 transition-colors whitespace-nowrap">
        検索
      </button>
    </form>
  );
}
