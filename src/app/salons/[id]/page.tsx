'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import Spinner from '@/components/Spinner';
import type { Salon } from '@/types';

export default function SalonDetailPage({ params }: { params: { id: string } }) {
  const [salon, setSalon] = useState<Salon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/salons?id=${params.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { setSalon(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="section-container flex justify-center py-20"><Spinner /></div>;
  if (!salon) return (
    <div className="section-container text-center py-20">
      <h1 className="text-2xl font-bold mb-4">施設が見つかりません</h1>
      <p className="text-gray-500 mb-8">この施設は公開されていないか、存在しません。</p>
      <Link href="/salons" className="btn-primary px-8 py-3">施設一覧に戻る</Link>
    </div>
  );

  return (
    <div className="section-container">
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: '施設一覧', href: '/salons' }, { label: salon.facility_name }]} />

      <div className="max-w-3xl mx-auto">
        {salon.photo_url && (
          <div className="w-full h-64 bg-gray-100 rounded-2xl mb-6 overflow-hidden">
            <img src={salon.photo_url} alt={salon.facility_name} className="w-full h-full object-cover" />
          </div>
        )}

        <span className="text-sm font-medium px-3 py-1 rounded-full bg-sky-50 text-sky-600">{salon.business_type}</span>
        <h1 className="text-2xl sm:text-3xl font-bold mt-3 mb-6">{salon.facility_name}</h1>

        {salon.pr_text && (
          <div className="mb-8">
            <h2 className="font-bold text-lg mb-2">施設紹介</h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-line">{salon.pr_text}</p>
          </div>
        )}

        <div className="card mb-8">
          <h2 className="font-bold text-lg mb-4">基本��報</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['住所', salon.address],
              ['営業時間', salon.business_hours],
              ['定休日', salon.regular_holiday],
              ['席数', salon.seat_count ? `${salon.seat_count}席` : null],
              ['スタッフ数', salon.staff_count ? `${salon.staff_count}名` : null],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label as string} className="flex border-b border-gray-100 pb-3">
                <dt className="w-24 text-gray-500 flex-shrink-0">{label}</dt>
                <dd className="text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="p-6 rounded-2xl text-center text-white" style={{ backgroundColor: 'var(--primary)' }}>
          <p className="text-lg font-bold mb-2">この施設に��味がありますか？</p>
          <p className="text-white/80 text-sm mb-4">お問い合わせは下記よりお気軽にどうぞ</p>
          <Link href="/contact" className="inline-block px-8 py-3 bg-white font-bold rounded-lg hover:bg-gray-100" style={{ color: 'var(--primary)' }}>
            お問い合わせ
          </Link>
        </div>
      </div>
    </div>
  );
}
