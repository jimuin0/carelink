'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { SbInput } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

export default function CouponEditPage() {
  const params = useParams();
  const router = useRouter();
  const couponId = params.id as string;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [couponType, setCouponType] = useState('all');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadCoupon = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/admin/coupons'); return; }

    const { data, error } = await supabase.from('coupons').select('*').eq('id', couponId).single();
    // 行なし（PGRST116）は従来どおり一覧へ戻す。通信/権限エラーは空フォーム上書き事故を防ぐため明示する
    if (error) {
      if (error.code === 'PGRST116') { router.push('/admin/coupons'); return; }
      setLoadError(true); setLoading(false); return;
    }
    if (!data) { router.push('/admin/coupons'); return; }
    setName(data.name);
    setDescription(data.description || '');
    setCouponType(data.coupon_type);
    setDiscountType(data.discount_type);
    setDiscountValue(data.discount_value?.toString() || '');
    setSpecialPrice(data.special_price?.toString() || '');
    setValidFrom(data.valid_from || '');
    setValidUntil(data.valid_until || '');
    setIsActive(data.is_active ?? true);
    setLoading(false);
  }, [couponId, router]);

  useEffect(() => { loadCoupon().catch(() => { setLoadError(true); setLoading(false); }); }, [loadCoupon]);

  const handleSave = async () => {
    if (saving || !name.trim()) {
      setToast({ type: 'error', message: 'クーポン名は必須です' });
      return;
    }

    // Client-side pre-validation
    const dv = discountType !== 'special_price' && discountValue ? parseInt(discountValue) : null;
    const sp = discountType === 'special_price' && specialPrice ? parseInt(specialPrice) : null;
    if (dv !== null && dv < 0) {
      setToast({ type: 'error', message: '割引額は0以上で入力してください' });
      return;
    }
    if (discountType === 'percentage' && dv !== null && dv > 100) {
      setToast({ type: 'error', message: '割合割引は0〜100%で入力してください' });
      return;
    }
    if (sp !== null && sp < 0) {
      setToast({ type: 'error', message: '特別価格は0以上で入力してください' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          coupon_type: couponType,
          discount_type: discountType,
          discount_value: dv,
          special_price: sp,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: err.error ?? '保存に失敗しました' });
      } else {
        setDirty(false);
        setToast({ type: 'success', message: '保存しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    try {
      const res = await fetch(`/api/admin/coupons/${couponId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: err.error ?? '削除に失敗しました' });
      } else {
        router.push('/admin/coupons');
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    }
  };

  if (loading) return <AdminPageLoading />;

  // 取得失敗時はフォームを描画しない（空フォームを保存して実データを上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">クーポン編集</h1>
        <LoadError onRetry={loadCoupon} message="クーポンの読み込みに失敗しました" />
      </div>
    );
  }

  return (
    <div onChange={() => setDirty(true)}>
      <h1 className="text-2xl font-bold mb-6">クーポン編集</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="coupon-name" className="form-label">クーポン名 <span className="text-red-500">*</span></label>
          <SbInput id="coupon-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <label htmlFor="coupon-desc" className="form-label">説明</label>
          <textarea id="coupon-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={3} maxLength={500} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="coupon-type" className="form-label">対象</label>
            <select id="coupon-type" value={couponType} onChange={(e) => setCouponType(e.target.value)} className="form-input">
              <option value="all">全員</option>
              <option value="new_customer">新規</option>
              <option value="repeat">リピーター</option>
              <option value="limited_time">期間限定</option>
            </select>
          </div>
          <div>
            <label htmlFor="discount-type" className="form-label">割引タイプ</label>
            <select id="discount-type" value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="form-input">
              <option value="fixed">固定額OFF</option>
              <option value="percentage">%OFF</option>
              <option value="special_price">特別価格</option>
            </select>
          </div>
        </div>
        {discountType !== 'special_price' ? (
          <div>
            <label htmlFor="discount-val" className="form-label">
              割引値{discountType === 'fixed' ? '（円）' : '（%）※0〜100'}
            </label>
            <SbInput
              id="discount-val"
              type="number"
              min={0}
              max={discountType === 'percentage' ? 100 : 100000}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="special-price" className="form-label">特別価格（円）</label>
            <SbInput
              id="special-price"
              type="number"
              min={0}
              value={specialPrice}
              onChange={(e) => setSpecialPrice(e.target.value)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="valid-from" className="form-label">有効開始日</label>
            <SbInput id="valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="valid-until" className="form-label">有効終了日</label>
            <SbInput id="valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="text-sm">有効</span>
          </label>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push('/admin/coupons')} className="text-sm text-gray-500 hover:underline">戻る</button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        <div className="pt-2 border-t">
          <button type="button" onClick={handleDelete} className="text-sm text-red-500 hover:underline">このクーポンを削除</button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmDelete}
        title="クーポンを削除"
        message="このクーポンを削除しますか？"
        confirmLabel="削除する"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
