'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import Spinner from '@/components/Spinner';
import type { Salon } from '@/types';
import { businessTypes } from '@/lib/constants';

export default function SalonsPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [businessType, setBusinessType] = useState('');
  const [area, setArea] = useState('');

  useEffect(() => {
    fetchSalons();
  }, []);

  async function fetchSalons() {
    setLoading(true);
    const params = new URLSearchParams();
    if (businessType) params.set('business_type', businessType);
    if (area) params.set('area', area);
    const res = await fetch(`/api/salons?${params}`);
    const data = await res.json();
    setSalons(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  function handleSearch() {
    fetchSalons();
  }

  return (
    <div className="section-container">
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: '施設一覧' }]} />
      <h1 className="text-2xl sm:text-3xl font-bold mb-6">掲載施設一覧</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8 p-4 bg-gray-50 rounded-xl">
        <select
          value={businessType}
          onChange={(e) => setBusinessType(e.target.value)}
          className="form-input flex-1"
        >
          <option value="">業種で絞り込み</option>
          {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="text"
          placeholder="エリアで検索（例: 大阪市、豊中市）"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="form-input flex-1"
        />
        <button onClick={handleSearch} className="btn-primary px-6 py-2 whitespace-nowrap">検索</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : salons.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg mb-2">現在掲載中の施設はありません</p>
          <p className="text-gray-400 text-sm mb-6">施設の掲載は完全無料です</p>
          <Link href="/register" className="btn-primary px-6 py-3">施設を無料で掲載する</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {salons.map((s) => (
            <Link key={s.id} href={`/salons/${s.id}`} className="card hover:shadow-lg transition-shadow group">
              {s.photo_url && (
                <div className="w-full h-40 bg-gray-100 rounded-lg mb-4 overflow-hidden">
                  <img src={s.photo_url} alt={s.facility_name} className="w-full h-full object-cover" />
                </div>
              )}
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-sky-50 text-sky-600">{s.business_type}</span>
              <h2 className="font-bold text-lg mt-2 group-hover:text-sky-600 transition-colors">{s.facility_name}</h2>
              {s.address && <p className="text-gray-500 text-sm mt-1">{s.address}</p>}
              {s.pr_text && <p className="text-gray-400 text-sm mt-2 line-clamp-2">{s.pr_text}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
