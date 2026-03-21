'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { businessTypes } from '@/lib/validations';
import { prefectures } from '@/lib/constants';

export default function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [prefecture, setPrefecture] = useState(searchParams.get('area') || '');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (type) params.set('type', type);
    if (prefecture) params.set('area', prefecture);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
      <div className="grid sm:grid-cols-4 gap-3">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="キーワード（施設名・エリアなど）"
          className="form-input sm:col-span-2"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="form-input"
        >
          <option value="">すべての業種</option>
          {businessTypes.filter(t => t !== 'その他').map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={prefecture}
          onChange={(e) => setPrefecture(e.target.value)}
          className="form-input"
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
    </form>
  );
}
