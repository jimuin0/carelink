'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function NewCouponPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [couponType, setCouponType] = useState('all');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async () => {
    if (saving || !name) return;
    setSaving(true);

    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .single();

    if (!membership) { setSaving(false); return; }

    const { error } = await supabase.from('coupons').insert({
      facility_id: membership.facility_id,
      name,
      description: description || null,
      coupon_type: couponType,
      discount_type: discountType,
      discount_value: discountValue ? parseInt(discountValue) : null,
      special_price: specialPrice ? parseInt(specialPrice) : null,
      valid_from: validFrom || null,
      valid_until: validUntil || null,
    });

    if (error) {
      setToast({ type: 'error', message: '作成に失敗しました' });
    } else {
      router.push('/admin/coupons');
    }
    setSaving(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">クーポン新規作成</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className="form-label">クーポン名 <span className="text-red-500">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" placeholder="新規限定20%OFF" />
        </div>
        <div>
          <label className="form-label">説明</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">対象</label>
            <select value={couponType} onChange={(e) => setCouponType(e.target.value)} className="form-input">
              <option value="all">全員</option>
              <option value="new_customer">新規</option>
              <option value="repeat">リピーター</option>
              <option value="limited_time">期間限定</option>
            </select>
          </div>
          <div>
            <label className="form-label">割引タイプ</label>
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="form-input">
              <option value="fixed">定額割引</option>
              <option value="percentage">割合割引</option>
              <option value="special_price">特別価格</option>
            </select>
          </div>
        </div>
        {discountType !== 'special_price' ? (
          <div>
            <label className="form-label">割引額{discountType === 'percentage' ? '(%)' : '(円)'}</label>
            <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="form-input" />
          </div>
        ) : (
          <div>
            <label className="form-label">特別価格(円)</label>
            <input type="number" value={specialPrice} onChange={(e) => setSpecialPrice(e.target.value)} className="form-input" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">有効期限（開始）</label>
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">有効期限（終了）</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="form-input" />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={() => router.push('/admin/coupons')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '作成中...' : 'クーポンを作成'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
