'use client';

import { useEffect, useState } from 'react';
import { useLiff } from '@/hooks/useLiff';

type Coupon = {
  id: string;
  name: string;
  description: string | null;
  discount_type: string;
  discount_value: number | null;
  special_price: number | null;
  valid_until: string | null;
  coupon_type: string;
  facility_profiles?: { name: string } | null;
};

function LiffLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
    </div>
  );
}
function LiffError({ message }: { message: string }) {
  return <div className="flex items-center justify-center min-h-screen p-4"><p role="alert" className="text-red-500 text-sm">{message}</p></div>;
}
function LiffNotLinked() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-4">
        <p className="text-2xl">🔗</p>
        <p className="font-bold text-gray-900">LINE連携が必要です</p>
        <a href="/mypage/settings" className="inline-block bg-[#06C755] text-white px-6 py-2.5 rounded-full text-sm font-bold">設定ページへ</a>
      </div>
    </div>
  );
}

function discountText(coupon: Coupon): string {
  if (coupon.discount_type === 'percent' && coupon.discount_value) {
    return `${coupon.discount_value}%OFF`;
  }
  if (coupon.discount_type === 'fixed' && coupon.discount_value) {
    return `¥${coupon.discount_value.toLocaleString()}OFF`;
  }
  if (coupon.discount_type === 'special' && coupon.special_price) {
    return `¥${coupon.special_price.toLocaleString()}`;
  }
  return '特別割引';
}

export default function LiffCouponsPage() {
  const liff = useLiff();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (liff.status !== 'ready') return;
    setLoading(true);
    fetch('/api/liff/coupons')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setCoupons(d.coupons || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [liff]);

  if (liff.status === 'loading') return <LiffLoading />;
  if (liff.status === 'error') return <LiffError message={liff.message} />;
  if (liff.status === 'not_linked') return <LiffNotLinked />;

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">クーポン</h1>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-3xl mb-3">🎟️</p>
          <p className="text-gray-400 text-sm">利用可能なクーポンはありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-3 flex items-center justify-between">
                <span className="text-white font-bold text-lg">{discountText(c)}</span>
                <span className="text-white/80 text-xs">
                  {c.coupon_type === 'new_customer' ? '新規限定' :
                   c.coupon_type === 'repeat' ? 'リピーター' :
                   c.coupon_type === 'limited' ? '期間限定' : '全員'}
                </span>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-bold text-gray-900">{c.name}</p>
                {c.facility_profiles?.name && (
                  <p className="text-xs text-gray-500 mt-0.5">{c.facility_profiles.name}</p>
                )}
                {c.description && (
                  <p className="text-xs text-gray-500 mt-1">{c.description}</p>
                )}
                {c.valid_until && (
                  <p className="text-xs text-gray-400 mt-2">
                    有効期限: {new Date(c.valid_until).toLocaleDateString('ja-JP')}まで
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
