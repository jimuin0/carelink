'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';

type MenuOption = { id: string; name: string; price: number | null };

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
  // 【2026年7月15日 HPB準拠仕様】対象メニュー限定（coupon_menus）。未選択＝全メニュー適用。
  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);
  const [targetMenuIds, setTargetMenuIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 対象メニュー選択肢のロード（自施設の facility_menus）。取得失敗は「メニューなし」に
  // 偽装せずエラーメッセージを明示する（作成自体＝全メニュー適用クーポンは妨げない）。
  const [menuLoadError, setMenuLoadError] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: membership, error: memError } = await supabase
          .from('facility_members')
          .select('facility_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();
        if (memError || !membership) { setMenuLoadError(true); return; }
        const { data: menus, error: menusError } = await supabase
          .from('facility_menus')
          .select('id, name, price')
          .eq('facility_id', membership.facility_id)
          .order('sort_order');
        if (menusError) { setMenuLoadError(true); return; }
        setMenuOptions((menus ?? []) as MenuOption[]);
      } catch {
        setMenuLoadError(true);
      }
    })();
  }, []);

  const toggleTargetMenu = (menuId: string) => {
    setTargetMenuIds((prev) =>
      prev.includes(menuId) ? prev.filter((id) => id !== menuId) : [...prev, menuId]
    );
  };

  const handleCreate = async () => {
    if (saving) return;
    if (!name.trim()) {
      setToast({ type: 'error', message: 'クーポン名を入力してください' });
      return;
    }

    // Client-side pre-validation
    const dv = discountValue ? parseInt(discountValue) : null;
    const sp = specialPrice ? parseInt(specialPrice) : null;
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
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }

      const { data: membership, error: memErr } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (memErr || !membership) { setSaving(false); return; }

      const res = await fetch(`/api/admin/coupons?facility_id=${membership.facility_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          coupon_type: couponType,
          discount_type: discountType,
          discount_value: discountType !== 'special_price' ? dv : null,
          special_price: discountType === 'special_price' ? sp : null,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
          target_menu_ids: targetMenuIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: err.error ?? '作成に失敗しました' });
      } else {
        router.push('/admin/coupons');
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SbPageHeader title="クーポン新規作成" />

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="coupon-name" className="form-label">クーポン名 <span className="text-red-500">*</span></label>
          <SbInput id="coupon-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="新規限定20%OFF" maxLength={100} />
        </div>
        <div>
          <label htmlFor="coupon-desc" className="form-label">説明</label>
          <textarea id="coupon-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={2} maxLength={500} />
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
            <label htmlFor="coupon-discount-type" className="form-label">割引タイプ</label>
            <select id="coupon-discount-type" value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="form-input">
              <option value="fixed">定額割引</option>
              <option value="percentage">割合割引</option>
              <option value="special_price">特別価格</option>
            </select>
          </div>
        </div>
        {discountType !== 'special_price' ? (
          <div>
            <label htmlFor="coupon-value" className="form-label">
              割引額{discountType === 'percentage' ? '(%) ※0〜100' : '(円)'}
            </label>
            <SbInput
              id="coupon-value"
              type="number"
              min={0}
              max={discountType === 'percentage' ? 100 : 100000}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="coupon-special" className="form-label">特別価格(円)</label>
            <SbInput
              id="coupon-special"
              type="number"
              min={0}
              value={specialPrice}
              onChange={(e) => setSpecialPrice(e.target.value)}
            />
          </div>
        )}
        <div>
          <span className="form-label">対象メニュー（HPB準拠・複数選択可）</span>
          <p className="text-xs text-gray-400 mb-2">
            選択したメニューにのみクーポンが適用されます（対象外メニューは定価）。未選択の場合は全メニューに適用されます。
          </p>
          {menuLoadError ? (
            <p className="text-xs text-red-500 border border-red-200 rounded-lg p-3">メニューの読み込みに失敗しました。対象メニューを設定する場合はページを再読み込みしてください。</p>
          ) : menuOptions.length === 0 ? (
            <p className="text-xs text-gray-400 border rounded-lg p-3">選択できるメニューがありません（メニュー未登録）</p>
          ) : (
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {menuOptions.map((menu) => (
                <label key={menu.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={targetMenuIds.includes(menu.id)}
                    onChange={() => toggleTargetMenu(menu.id)}
                  />
                  <span className="flex-1">{menu.name}</span>
                  {menu.price !== null && <span className="text-xs text-gray-500">¥{menu.price.toLocaleString()}</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="coupon-from" className="form-label">有効期限（開始）</label>
            <SbInput id="coupon-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="coupon-until" className="form-label">有効期限（終了）</label>
            <SbInput id="coupon-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push('/admin/coupons')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleCreate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '作成中...' : 'クーポンを作成'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
