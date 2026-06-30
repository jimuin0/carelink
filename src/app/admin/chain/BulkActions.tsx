'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

interface Props {
  facilityIds: string[];
  facilityNames: { id: string; name: string }[];
}

export default function ChainBulkActions({ facilityIds, facilityNames }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'coupon' | 'publish'>('coupon');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Coupon form
  const [couponName, setCouponName] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed' | 'special'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [submittingCoupon, setSubmittingCoupon] = useState(false);

  // Publish form
  const [publishAction, setPublishAction] = useState<'publish' | 'unpublish'>('publish');
  const [submittingPublish, setSubmittingPublish] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const handleBulkCoupon = async () => {
    if (!couponName || !discountValue) return;
    setSubmittingCoupon(true);
    try {
      const res = await fetch('/api/admin/chain/bulk-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: couponName,
          coupon_type: 'all',
          discount_type: discountType,
          discount_value: discountType !== 'special' ? Number(discountValue) : null,
          special_price: discountType === 'special' ? Number(discountValue) : null,
          valid_until: validUntil || null,
          facility_ids: facilityIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: 'error', message: (data as { error?: string }).error || '発行に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: `${(data as { created?: number }).created ?? 0}施設にクーポンを発行しました` });
      setCouponName(''); setDiscountValue(''); setValidUntil('');
    } finally {
      setSubmittingCoupon(false);
    }
  };

  const handleBulkPublish = () => {
    setConfirmPublish(true);
  };

  const doBulkPublish = async () => {
    setConfirmPublish(false);
    setSubmittingPublish(true);
    try {
      const res = await fetch('/api/admin/chain/bulk-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_ids: facilityIds, is_published: publishAction === 'publish' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: `${(data as { updated?: number }).updated ?? 0}施設の公開状態を変更しました。` });
        router.refresh(); // 手動リロード誘導をやめサーバーコンポーネントを再取得
      } else {
        setToast({ type: 'error', message: (data as { error?: string }).error || '変更に失敗しました' });
      }
    } finally {
      setSubmittingPublish(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="font-bold text-sm">一括操作</h2>
        <p className="text-xs text-gray-400 mt-0.5">全{facilityIds.length}施設に適用</p>
      </div>

      {/* Tab */}
      <div className="flex border-b border-gray-100">
        {([['coupon', 'クーポン一括発行'], ['publish', '公開状態一括変更']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              tab === key ? 'border-b-2 border-sky-500 text-sky-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'coupon' && (
          <div className="space-y-4 max-w-md">
            <div>
              <label htmlFor="chain-coupon-name" className="block text-xs font-medium text-gray-700 mb-1">クーポン名 <span className="text-red-500">*</span></label>
              <input
                id="chain-coupon-name"
                type="text"
                value={couponName}
                onChange={(e) => setCouponName(e.target.value)}
                placeholder="例: 夏のキャンペーン20%OFF"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">割引タイプ</label>
              <div className="flex gap-3">
                {([['percent', '割引率(%)'], ['fixed', '固定額(円)'], ['special', '特別価格(円)']] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" value={v} checked={discountType === v} onChange={() => setDiscountType(v)} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="chain-discount-value" className="block text-xs font-medium text-gray-700 mb-1">
                {discountType === 'percent' ? '割引率(%)' : discountType === 'fixed' ? '割引額(円)' : '特別価格(円)'} <span className="text-red-500">*</span>
              </label>
              <input
                id="chain-discount-value"
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                min={1}
                max={discountType === 'percent' ? 100 : undefined}
                className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="chain-valid-until" className="block text-xs font-medium text-gray-700 mb-1">有効期限（任意）</label>
              <input
                id="chain-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="pt-1">
              <p className="text-xs text-gray-400 mb-3">
                対象施設: {facilityNames.map((f) => f.name).join('、')}
              </p>
              <button
                type="button"
                onClick={handleBulkCoupon}
                disabled={submittingCoupon || !couponName || !discountValue}
                className="btn-primary !px-5 !py-2.5 text-sm"
              >
                {submittingCoupon ? '発行中...' : `${facilityIds.length}施設に一括発行`}
              </button>
            </div>
          </div>
        )}

        {tab === 'publish' && (
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">操作</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={publishAction === 'publish'} onChange={() => setPublishAction('publish')} />
                  <span className="text-sm text-green-600 font-medium">全施設を公開にする</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={publishAction === 'unpublish'} onChange={() => setPublishAction('unpublish')} />
                  <span className="text-sm text-gray-600 font-medium">全施設を非公開にする</span>
                </label>
              </div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
              全{facilityIds.length}施設が対象です。個別に変更したい場合は施設ごとの設定ページをご利用ください。
            </div>
            <button
              type="button"
              onClick={handleBulkPublish}
              disabled={submittingPublish}
              className={`px-5 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors text-white ${
                publishAction === 'publish' ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'
              }`}
            >
              {submittingPublish ? '変更中...' : `${facilityIds.length}施設を一括${publishAction === 'publish' ? '公開' : '非公開'}`}
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmPublish}
        title="公開状態を一括変更"
        message={`全${facilityIds.length}施設を${publishAction === 'publish' ? '公開' : '非公開'}にしますか？`}
        confirmLabel="変更する"
        onConfirm={doBulkPublish}
        onCancel={() => setConfirmPublish(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
