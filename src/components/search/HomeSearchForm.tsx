'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { businessTypes } from '@/lib/constants';

export default function HomeSearchForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (type) params.set('type', type);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-3xl mx-auto">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="キーワードで探す（例：まつげパーマ、腰痛）"
        className="form-input flex-1"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="form-input sm:w-52"
      >
        <option value="">すべての業種</option>
        {businessTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <button type="submit" className="btn-primary whitespace-nowrap px-6">
        検索
      </button>
    </form>
  );
}
