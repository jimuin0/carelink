'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { StaffProfile, FacilityMenu, Coupon, AvailableSlot } from '@/types';

type Step = 'menu' | 'staff' | 'datetime' | 'confirm';

interface Props {
  facility: { id: string; slug: string; name: string };
  staff: StaffProfile[];
  menus: FacilityMenu[];
  coupons: Coupon[];
}

export default function BookingFlow({ facility, staff, menus, coupons }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('menu');
  const [selectedMenus, setSelectedMenus] = useState<FacilityMenu[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(null);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Pre-fill from user profile
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCustomerName(user.user_metadata?.display_name || '');
        setEmail(user.email || '');
      }
    }).catch(() => {});
  }, []);

  const totalDuration = selectedMenus.reduce((sum, m) => sum + (m.duration_minutes || 60), 0);

  // Fetch available slots when date changes
  useEffect(() => {
    if (!selectedDate || selectedMenus.length === 0) return;
    if (selectedStaff === null && staff.length === 0) return;
    const controller = new AbortController();
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlot(null);

    if (selectedStaff) {
      fetch(`/api/slots?facilityId=${facility.id}&staffId=${selectedStaff.id}&date=${selectedDate}&duration=${totalDuration}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => { if (!controller.signal.aborted) setSlots(data.slots ?? []); })
        .catch((err) => { if (err.name !== 'AbortError') setToast({ type: 'error', message: '空き枠の取得に失敗しました' }); })
        .finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    } else {
      Promise.all(
        staff.map((s) =>
          fetch(`/api/slots?facilityId=${facility.id}&staffId=${s.id}&date=${selectedDate}&duration=${totalDuration}`, {
            signal: controller.signal,
          }).then((r) => r.json()).catch(() => ({ slots: [] }))
        )
      ).then((results) => {
        if (controller.signal.aborted) return;
        const merged = new Map<string, AvailableSlot>();
        results.forEach((r) => {
          (r.slots ?? []).forEach((slot: AvailableSlot) => merged.set(slot.slot_start, slot));
        });
        setSlots(Array.from(merged.values()).sort((a, b) => a.slot_start.localeCompare(b.slot_start)));
      }).catch((err) => { if (err.name !== 'AbortError') setToast({ type: 'error', message: '空き枠の取得に失敗しました' }); })
        .finally(() => { if (!controller.signal.aborted) setSlotsLoading(false); });
    }

    return () => controller.abort();
  }, [selectedDate, selectedStaff, selectedMenus, facility.id, totalDuration, staff]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [availablePoints, setAvailablePoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
      if (user) {
        supabase.from('user_points').select('points').eq('user_id', user.id).then(({ data }) => {
          const total = (data ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
          setAvailablePoints(Math.max(0, total));
        });
      }
    }).catch(() => setIsAuthenticated(false));
  }, []);

  // Warn on unsaved changes
  useEffect(() => {
    if (step === 'menu') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [step]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!customerName || !email) {
      setToast({ type: 'error', message: 'お名前とメールアドレスは必須です' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setToast({ type: 'error', message: '正しいメールアドレスを入力してください' });
      return;
    }
    setSubmitting(true);

    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facility_id: facility.id,
        staff_id: selectedStaff?.id ?? null,
        menu_id: selectedMenus[0]?.id ?? null,
        menu_ids: selectedMenus.map((m) => m.id),
        coupon_id: selectedCoupon?.id ?? null,
        booking_date: selectedDate,
        start_time: selectedSlot?.slot_start,
        end_time: selectedSlot?.slot_end,
        customer_name: customerName,
        email,
        phone: phone || null,
        note: note || null,
        total_price: calculatePrice(),
        points_used: usePoints && pointsToUse > 0 ? pointsToUse : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const completeParams = new URLSearchParams({
        id: body?.bookingId || '',
        date: selectedDate || '',
        time: selectedSlot?.slot_start || '',
        end_time: selectedSlot?.slot_end || '',
        facility: facility.name || '',
      });
      router.push(`/facility/${encodeURIComponent(facility.slug)}/booking/complete?${completeParams.toString()}`);
    } else {
      const body = await res.json().catch(() => null);
      setToast({ type: 'error', message: body?.error || '予約に失敗しました' });
    }
    setSubmitting(false);
  };

  const calculatePrice = () => {
    if (selectedMenus.length === 0) return null;
    const menuTotal = selectedMenus.reduce((sum, m) => sum + (m.price || 0), 0);
    if (menuTotal === 0) return null;
    let price = menuTotal;
    if (selectedCoupon) {
      if (selectedCoupon.discount_type === 'fixed' && selectedCoupon.discount_value) {
        price = Math.max(0, price - selectedCoupon.discount_value);
      } else if (selectedCoupon.discount_type === 'percentage' && selectedCoupon.discount_value) {
        price = Math.round(price * (1 - selectedCoupon.discount_value / 100));
      } else if (selectedCoupon.discount_type === 'special_price' && selectedCoupon.special_price !== null) {
        price = selectedCoupon.special_price;
      }
    }
    if (selectedStaff && (selectedStaff.nomination_fee || 0) > 0) {
      price += selectedStaff.nomination_fee || 0;
    }
    return price;
  };

  // Generate date options (next 60 days)
  const dateOptions = Array.from({ length: 60 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const steps: { key: Step; label: string }[] = [
    { key: 'menu', label: 'メニュー' },
    { key: 'staff', label: 'スタッフ' },
    { key: 'datetime', label: '日時' },
    { key: 'confirm', label: '確認・予約' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i <= currentIndex ? 'bg-primary text-white' : 'bg-gray-200 text-gray-400'
            }`}>
              {i + 1}
            </div>
            <span className={`text-xs whitespace-nowrap ${i <= currentIndex ? 'text-primary font-bold' : 'text-gray-400'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Menu (multi-select + coupon) */}
      {step === 'menu' && (
        <div className="space-y-3">
          <h2 className="font-bold">メニューを選択<span className="text-xs font-normal text-gray-400 ml-2">（複数選択可）</span></h2>
          {menus.length === 0 && (
            <div className="bg-white rounded-xl p-8 text-center">
              <p className="text-gray-400">メニューが登録されていません</p>
              <p className="text-xs text-gray-400 mt-2">施設にお問い合わせください</p>
            </div>
          )}
          {menus.map((menu) => {
            const isSelected = selectedMenus.some((m) => m.id === menu.id);
            return (
              <button
                type="button"
                key={menu.id}
                onClick={() => {
                  setSelectedMenus((prev) =>
                    isSelected ? prev.filter((m) => m.id !== menu.id) : [...prev, menu]
                  );
                }}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  isSelected ? 'border-primary bg-sky-50' : 'border-gray-200 hover:border-sky-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary bg-primary' : 'border-gray-300'}`}>
                    {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{menu.name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {menu.price !== null && <span>¥{menu.price.toLocaleString()}</span>}
                      {menu.duration_minutes && <span>{menu.duration_minutes}分</span>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Coupon selection */}
          {coupons.length > 0 && (
            <div className="mt-4">
              <h3 className="font-bold text-sm mb-2">クーポンを使う</h3>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedCoupon(null)}
                  className={`w-full text-left p-3 rounded-xl border text-sm ${
                    !selectedCoupon ? 'border-primary bg-sky-50' : 'border-gray-200'
                  }`}
                >
                  クーポンなし
                </button>
                {coupons.map((coupon) => (
                  <button
                    type="button"
                    key={coupon.id}
                    onClick={() => setSelectedCoupon(coupon)}
                    className={`w-full text-left p-3 rounded-xl border text-sm ${
                      selectedCoupon?.id === coupon.id ? 'border-primary bg-sky-50' : 'border-gray-200'
                    }`}
                  >
                    <p className="font-bold">{coupon.name}</p>
                    {coupon.description && <p className="text-xs text-gray-500">{coupon.description}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedMenus.length > 0 && (
            <div className="pt-2 border-t space-y-2">
              <div className="text-sm text-gray-600">
                <span className="font-bold">{selectedMenus.length}件選択中</span>
                <span className="ml-3">合計 ¥{selectedMenus.reduce((s, m) => s + (m.price || 0), 0).toLocaleString()}</span>
                <span className="ml-3">{selectedMenus.reduce((s, m) => s + (m.duration_minutes || 60), 0)}分</span>
              </div>
              <button type="button" onClick={() => setStep('staff')} className="btn-primary w-full !py-3">
                次へ（スタッフ選択）
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Staff */}
      {step === 'staff' && (
        <div className="space-y-3">
          <h2 className="font-bold">スタッフを選択</h2>
          <button
            type="button"
            onClick={() => { setSelectedStaff(null); setStep('datetime'); }}
            className="w-full text-left p-4 rounded-xl border border-sky-300 bg-sky-50 transition-colors hover:bg-sky-100"
          >
            <p className="font-bold text-sm text-sky-700">指名なし（おまかせ）</p>
            <p className="text-xs text-gray-500">空いているスタッフが対応します</p>
          </button>
          {staff.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => { setSelectedStaff(s); setStep('datetime'); }}
              className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-sky-300"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">{s.name}</p>
                  {s.position && <p className="text-xs text-gray-500">{s.position}</p>}
                </div>
                {s.nomination_fee > 0 && (
                  <span className="text-xs text-sky-600 font-medium">指名料 ¥{s.nomination_fee.toLocaleString()}</span>
                )}
              </div>
            </button>
          ))}
          <button type="button" onClick={() => setStep('menu')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
        </div>
      )}

      {/* Step 3: DateTime (date + time combined) */}
      {step === 'datetime' && (
        <div className="space-y-4">
          <h2 className="font-bold">日時を選択</h2>

          {/* Date grid */}
          <div>
            <p className="text-xs text-gray-500 mb-2">日付を選択してください</p>
            <div className="grid grid-cols-5 sm:grid-cols-7 gap-1.5">
              {dateOptions.map((date) => {
                const d = new Date(date);
                const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isActive = selectedDate === date;
                return (
                  <button
                    type="button"
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`p-2 rounded-lg border text-center transition-colors ${
                      isActive ? 'border-primary bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 hover:border-sky-300'
                    }`}
                  >
                    <p className="text-micro text-gray-400">{d.getMonth() + 1}/{d.getDate()}</p>
                    <p className={`text-xs font-bold ${isWeekend ? 'text-red-500' : ''}`}>
                      {dayNames[d.getDay()]}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time slots (shown when date is selected) */}
          {selectedDate && (
            <div>
              <p className="text-xs text-gray-500 mb-2">
                {(() => {
                  const d = new Date(selectedDate);
                  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
                  return `${d.getMonth() + 1}/${d.getDate()}（${dayNames[d.getDay()]}）の空き時間`;
                })()}
              </p>
              {slotsLoading ? (
                <div className="text-center py-6">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : slots.length === 0 ? (
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-gray-400 text-sm">この日は予約可能な時間帯がありません</p>
                  <p className="text-xs text-gray-400 mt-1">別の日付をお選びください</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {slots.map((slot) => {
                    const isActive = selectedSlot?.slot_start === slot.slot_start;
                    return (
                      <button
                        type="button"
                        key={slot.slot_start}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-2.5 rounded-xl border text-center transition-colors ${
                          isActive ? 'border-primary bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 hover:border-sky-300'
                        }`}
                      >
                        <p className="font-bold text-sm">{slot.slot_start.slice(0, 5)}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setStep('staff')} className="text-sm text-gray-500 hover:underline">
              戻る
            </button>
            {selectedSlot && (
              <button type="button" onClick={() => setStep('confirm')} className="btn-primary flex-1 !py-3">
                次へ（確認・予約）
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Confirm (info + summary + submit combined) */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="font-bold">予約内容の確認・お客様情報</h2>

          {/* Summary card */}
          <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">施設</span>
              <span className="font-medium">{facility.name}</span>
            </div>
            {selectedMenus.map((m) => (
              <div key={m.id} className="flex justify-between">
                <span className="text-gray-500 ml-2">{m.name}</span>
                <span className="text-gray-500">{m.price !== null ? `¥${m.price.toLocaleString()}` : ''}</span>
              </div>
            ))}
            {selectedStaff && (
              <div className="flex justify-between">
                <span className="text-gray-500">スタッフ</span>
                <span className="font-medium">{selectedStaff.name}
                  {selectedStaff.nomination_fee > 0 && <span className="text-xs text-gray-400 ml-1">(+¥{selectedStaff.nomination_fee.toLocaleString()})</span>}
                </span>
              </div>
            )}
            {selectedCoupon && (
              <div className="flex justify-between">
                <span className="text-gray-500">クーポン</span>
                <span className="font-medium text-red-500">{selectedCoupon.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">日時</span>
              <span className="font-medium">{selectedDate} {selectedSlot?.slot_start.slice(0, 5)}〜{selectedSlot?.slot_end.slice(0, 5)}</span>
            </div>
            {calculatePrice() !== null && (() => {
              const menuTotal = selectedMenus.reduce((s, m) => s + (m.price || 0), 0);
              const finalPrice = calculatePrice() ?? 0;
              const hasCouponDiscount = selectedCoupon && menuTotal > finalPrice;
              return (
                <div className="border-t border-sky-200 pt-2 mt-2 space-y-1">
                  {hasCouponDiscount && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">通常合計</span>
                      <span className="text-gray-400 line-through">¥{menuTotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-bold">{hasCouponDiscount ? 'クーポン適用後' : '合計金額'}</span>
                    <span className="font-bold text-lg text-red-500">¥{finalPrice.toLocaleString()}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Customer info form */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">お客様情報</h3>
            <div>
              <label htmlFor="booking-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
              <input
                id="booking-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="form-input"
                placeholder="山田 太郎"
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="booking-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
              <input
                id="booking-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="form-input"
                placeholder="example@email.com"
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="booking-phone" className="form-label">電話番号</label>
              <input
                id="booking-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                className="form-input"
                placeholder="090-1234-5678"
              />
            </div>
            <div>
              <label htmlFor="booking-note" className="form-label">備考</label>
              <textarea
                id="booking-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="form-input"
                rows={3}
                placeholder="ご要望があればご記入ください"
              />
            </div>
          </div>

          {/* Points */}
          {isAuthenticated && availablePoints > 0 && calculatePrice() !== null && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={usePoints} onChange={(e) => { setUsePoints(e.target.checked); if (!e.target.checked) setPointsToUse(0); }} />
                <span>ポイントを使う（{availablePoints.toLocaleString()}pt 利用可能）</span>
              </label>
              {usePoints && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={Math.min(availablePoints, calculatePrice() || 0)}
                    value={pointsToUse}
                    onChange={(e) => setPointsToUse(Math.min(Number(e.target.value) || 0, availablePoints, calculatePrice() || 0))}
                    className="form-input !w-28 text-sm"
                  />
                  <span className="text-xs text-gray-500">pt（1pt=1円）</span>
                  <button type="button" onClick={() => setPointsToUse(Math.min(availablePoints, calculatePrice() || 0))} className="text-xs text-primary hover:underline">全額使用</button>
                </div>
              )}
              {usePoints && pointsToUse > 0 && (
                <p className="text-sm font-bold">お支払い金額: ¥{((calculatePrice() || 0) - pointsToUse).toLocaleString()}</p>
              )}
            </div>
          )}

          {isAuthenticated === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
              <p className="font-bold">ログインしていません</p>
              <p className="text-xs mt-1">ログインせずに予約すると、予約履歴から確認・キャンセルできません。</p>
              <a href={`/auth/login?redirect=/facility/${facility.slug}/booking`} className="text-xs text-primary hover:underline mt-1 inline-block">
                ログインする
              </a>
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('datetime')} className="text-sm text-gray-500 hover:underline">
              戻る
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 !py-3"
            >
              {submitting ? '予約中...' : 'この内容で予約する'}
            </button>
          </div>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
