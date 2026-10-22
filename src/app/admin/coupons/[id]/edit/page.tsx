'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import { formatApiErrorMessage } from '@/lib/api-error-message';
import { COUPON_TARGET_ADMIN_HELP } from '@/lib/coupon-eligibility';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import {couponOperationKey,beginCouponOperation,finishCouponOperation,recoverCouponOperation} from '@/lib/coupon-operation';

type MenuOption = { id: string; name: string; price: number | null };

export default function CouponEditPage() {
  const params = useParams();
  const requested=useSearchParams().get('facility_id');
  const couponId=params.id as string;
  return <CouponEditor key={`${couponId}:${requested ?? 'unselected'}`} couponId={couponId} requested={requested} />;
}

function CouponEditor({couponId,requested}:{couponId:string;requested:string|null}) {
  const router=useRouter();
  const [facilityId,setFacilityId]=useState<string|null>(null);
  const [actorId,setActorId]=useState<string|null>(null);
  const [choices,setChoices]=useState<AdminFacilityChoice[]>([]);
  const [deleting,setDeleting]=useState(false);
  const [confirmBack,setConfirmBack]=useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [couponType, setCouponType] = useState('all');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [isActive, setIsActive] = useState(true);
  // 【2026年7月15日 HPB準拠仕様】対象メニュー限定（coupon_menus）。未選択＝全メニュー適用。
  const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);
  const [targetMenuIds, setTargetMenuIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // retry は再取得を state 経由で駆動する（load をイベントハンドラからも effect からも
  // 呼べる形にすると Compiler の検出対象になるため、キーの変化で effect 側だけに寄せる）
  const [reloadKey, setReloadKey] = useState(0);

  const toggleTargetMenu = (menuId: string) => {
    setDirty(true);
    setTargetMenuIds((prev) =>
      prev.includes(menuId) ? prev.filter((id) => id !== menuId) : [...prev, menuId]
    );
  };

  // アンマウント後の setState を防ぐため cancelled フラグで守りつつ、非同期処理を effect 内へ inline する
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);setLoading(true);setFacilityId(null);
        const identity=await verifyAuthUser(supabase.auth);
        if(identity.state!=='verified')throw new Error('COUPON_ACCESS_UNAVAILABLE');

        if(requested!==null){
          const selected=await loadAdminFacilitySelection(supabase,identity.user.id,requested);
          if(!selected.selectedId)throw new Error('COUPON_ACCESS_UNAVAILABLE');
          for(const kind of ['update','retire'] as const){
            const recovered=await recoverCouponOperation(couponOperationKey(identity.user.id,selected.selectedId,kind,couponId),selected.selectedId,kind,couponId);
            if(cancelled)return;
            if(recovered!=='absent'){router.push(`/admin/coupons?facility_id=${selected.selectedId}`);return;}
          }
        }
        const {data,error}=await supabase.from('coupons').select('*').eq('id',couponId).maybeSingle();
        if(error||!data)throw new Error('COUPON_READ_UNAVAILABLE');
        const selection=await loadAdminFacilitySelection(supabase,identity.user.id,requested ?? data.facility_id);
        if(selection.selectedId!==data.facility_id)throw new Error('COUPON_SCOPE_MISMATCH');
        if(requested===null){router.push(`/admin/coupons/${couponId}/edit?facility_id=${data.facility_id}`);return;}
        if(cancelled)return;
        setChoices(selection.choices);
        setName(data.name);
        setDescription(data.description || '');
        setCouponType(data.coupon_type);
        setDiscountType(data.discount_type);
        setDiscountValue(data.discount_value?.toString() || '');
        setSpecialPrice(data.special_price?.toString() || '');
        setValidFrom(data.valid_from || '');
        setValidUntil(data.valid_until || '');
        setIsActive(data.is_active ?? true);

        // 対象メニュー限定の現在値（coupon_menus）と選択肢（自施設の facility_menus）。
        // ここが取得できないまま保存すると target_menu_ids: [] が送信され、既存の対象メニュー限定を
        // 意図せず解除（全メニュー適用化）してしまう金銭事故になるため、失敗は loadError に倒して
        // フォームを描画しない（既存の「空フォーム上書き事故防止」と同じ設計思想）。
        const [{ data: cmRows, error: cmError }, { data: menus, error: menusError }] = await Promise.all([
          supabase.from('coupon_menus').select('menu_id').eq('coupon_id', couponId),
          supabase.from('facility_menus').select('id, name, price').eq('facility_id', data.facility_id).order('sort_order'),
        ]);
        if (cmError || menusError || !Array.isArray(cmRows) || !Array.isArray(menus)) {
          if (!cancelled) { setLoadError(true); setLoading(false); }
          return;
        }
        if (cancelled) return;
        setTargetMenuIds((cmRows ?? []).map((r: { menu_id: string }) => r.menu_id));
        setMenuOptions((menus ?? []) as MenuOption[]);
        setActorId(identity.user.id);setFacilityId(selection.selectedId);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [couponId, requested, reloadKey,router]);

  const handleSave = async () => {
    if (saving || deleting || loading || loadError || !facilityId) return;
    if (!name.trim()) {
      setToast({ type: 'error', message: 'クーポン名は必須です' });
      return;
    }

    // Client-side pre-validation（サーバー zod＝src/lib/coupon-validation.ts の相互必須と同一の
    // 範囲・文言。旧文言「0以上で入力してください」はサーバーの1以上必須とずれており、0を入れると
    // クライアントを通過した後にサーバー 400 になる矛盾があった）
    const dv = discountType !== 'special_price' && discountValue ? parseInt(discountValue) : null;
    const sp = discountType === 'special_price' && specialPrice ? parseInt(specialPrice) : null;
    if (discountType === 'fixed' && (dv === null || dv < 1 || dv > 100000)) {
      setToast({ type: 'error', message: '定額割引は1円〜100,000円の範囲で入力してください' });
      return;
    }
    if (discountType === 'percentage' && (dv === null || dv < 1 || dv > 100)) {
      setToast({ type: 'error', message: '割合割引は1%〜100%の範囲で入力してください' });
      return;
    }
    if (discountType === 'special_price' && (sp === null || sp < 1)) {
      setToast({ type: 'error', message: '特別価格は1円以上で入力してください' });
      return;
    }

    setSaving(true);
    try {
      const identity=await verifyAuthUser(createBrowserSupabaseClient().auth);
      if(identity.state!=='verified' || identity.user.id!==actorId)throw new Error('COUPON_ACCESS_UNAVAILABLE');
      const operationKey=couponOperationKey(identity.user.id,facilityId,'update',couponId);
      const operation=beginCouponOperation(operationKey);
      const res = await fetch(`/api/admin/coupons/${couponId}?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json','Idempotency-Key':operation },
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
          target_menu_ids: targetMenuIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 400 の zod details（具体メッセージ）を優先表示。汎用「リクエストが不正です」だけだと
        // 何を直せばよいか分からないため（formatApiErrorMessage が fieldErrors を整形する）
        setToast({ type: 'error', message: formatApiErrorMessage(err, '保存に失敗しました') });
      } else {
        finishCouponOperation(operationKey);
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
    if(saving || deleting || !facilityId)return;
    setConfirmDelete(false);setDeleting(true);
    try {
      const identity=await verifyAuthUser(createBrowserSupabaseClient().auth);
      if(identity.state!=='verified' || identity.user.id!==actorId)throw new Error('COUPON_ACCESS_UNAVAILABLE');
      const operationKey=couponOperationKey(identity.user.id,facilityId,'retire',couponId);
      const operation=beginCouponOperation(operationKey);
      const res = await fetch(`/api/admin/coupons/${couponId}?facility_id=${facilityId}`, {
        method: 'DELETE',headers:{'Idempotency-Key':operation},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: err.error ?? '削除に失敗しました' });
      } else {
        finishCouponOperation(operationKey);setDirty(false);router.push(`/admin/coupons?facility_id=${facilityId}`);
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {setDeleting(false);}
  };

  if (loading) return <AdminPageLoading />;

  // 取得失敗時はフォームを描画しない（空フォームを保存して実データを上書きする事故を防ぐ）
  if (loadError || !facilityId) {
    return (
      <div>
        <SbPageHeader title="クーポン編集" />
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="クーポンの読み込みに失敗しました" />
      </div>
    );
  }

  return (
    <div onChange={() => setDirty(true)}>
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/coupons" dirty={dirty} busy={saving || deleting} />
      <SbPageHeader title="クーポン編集" />

      <div className="bg-white rounded-xl shadow-xs p-6 space-y-4">
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
            <select id="coupon-type" value={couponType} onChange={(e) => setCouponType(e.target.value)} className="form-input" aria-describedby="coupon-type-help">
              <option value="all">全員</option>
              <option value="new_customer">新規</option>
              <option value="repeat">リピーター</option>
              <option value="limited_time">期間限定</option>
            </select>
            <p id="coupon-type-help" className="text-xs text-gray-500 mt-1">{COUPON_TARGET_ADMIN_HELP}</p>
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
              割引値{discountType === 'fixed' ? '（円）' : '（%）※1〜100'}
            </label>
            <SbInput
              id="discount-val"
              type="number"
              min={1}
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
              min={1}
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
          {menuOptions.length === 0 ? (
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
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} aria-describedby="coupon-active-help" />
            <span className="text-sm">有効</span>
          </label>
          <p id="coupon-active-help" className="text-xs text-gray-500 mt-1">
            チェックを外すと、店舗ページと予約画面に表示されなくなります。クーポン一覧には「無効」として残り、いつでも再開できます。
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" disabled={saving || deleting} onClick={() => {if(dirty)setConfirmBack(true);else router.push(`/admin/coupons?facility_id=${facilityId}`);}} className="text-sm text-gray-500 hover:underline">戻る</button>
          <button type="button" onClick={handleSave} disabled={saving || deleting} className="btn-primary flex-1 py-3!">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        <div className="pt-2 border-t">
          <button type="button" disabled={saving || deleting} onClick={handleDelete} className="text-sm text-red-500 hover:underline">このクーポンを削除</button>
        </div>
      </div>

      <ConfirmDialog open={confirmBack} title="未保存の変更があります" message="未保存の変更を破棄して一覧へ戻りますか？" confirmLabel="破棄して戻る" confirmDisabled={saving || deleting}
        onCancel={()=>setConfirmBack(false)} onConfirm={()=>{if(!saving && !deleting)router.push(`/admin/coupons?facility_id=${facilityId}`);}} />
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmDelete}
        title="クーポンを削除"
        message="このクーポンを削除しますか？利用記録や予約があるクーポンは削除できないため、「無効」にして一覧に残します。"
        confirmLabel="削除する"
        variant="danger"
        confirmDisabled={saving || deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
