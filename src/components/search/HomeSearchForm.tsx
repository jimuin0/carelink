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
    <form onSubmit={handleSubmit} className="flex">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="サロン名から探す"
        className="flex-1 px-3 py-1.5 border border-gray-300 border-r-0 text-sm text-gray-800 focus:outline-none focus:border-sky-500"
      />
      <button type="submit" className="px-5 py-1.5 bg-gray-100 border border-gray-300 text-sm text-gray-700 hover:bg-gray-200 transition-colors whitespace-nowrap">
        検索
      </button>
    </form>
  );
}
