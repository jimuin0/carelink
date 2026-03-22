'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { StaffProfile, FacilityMenu, Coupon, AvailableSlot } from '@/types';

type Step = 'menu' | 'staff' | 'date' | 'time' | 'info' | 'confirm';

interface Props {
  facility: { id: string; slug: string; name: string };
  staff: StaffProfile[];
  menus: FacilityMenu[];
  coupons: Coupon[];
}

export default function BookingFlow({ facility, staff, menus, coupons }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('menu');
  const [selectedMenu, setSelectedMenu] = useState<FacilityMenu | null>(null);
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

  // Fetch available slots
  useEffect(() => {
    if (!selectedDate || !selectedStaff || !selectedMenu) return;
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlot(null);

    fetch(`/api/slots?facilityId=${facility.id}&staffId=${selectedStaff.id}&date=${selectedDate}&duration=${selectedMenu.duration_minutes || 60}`)
      .then((r) => r.json())
      .then((data) => setSlots(data.slots ?? []))
      .catch(() => setToast({ type: 'error', message: '空き枠の取得に失敗しました' }))
      .finally(() => setSlotsLoading(false));
  }, [selectedDate, selectedStaff, selectedMenu, facility.id]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facility_id: facility.id,
        staff_id: selectedStaff?.id ?? null,
        menu_id: selectedMenu?.id ?? null,
        coupon_id: selectedCoupon?.id ?? null,
        booking_date: selectedDate,
        start_time: selectedSlot?.slot_start,
        end_time: selectedSlot?.slot_end,
        customer_name: customerName,
        email,
        phone: phone || null,
        note: note || null,
        total_price: calculatePrice(),
      }),
    });

    if (res.ok) {
      router.push(`/facility/${facility.slug}/booking/complete`);
    } else {
      const { error } = await res.json();
      setToast({ type: 'error', message: error || '予約に失敗しました' });
    }
    setSubmitting(false);
  };

  const calculatePrice = () => {
    if (!selectedMenu?.price) return null;
    let price = selectedMenu.price;
    if (selectedCoupon) {
      if (selectedCoupon.discount_type === 'fixed' && selectedCoupon.discount_value) {
        price = Math.max(0, price - selectedCoupon.discount_value);
      } else if (selectedCoupon.discount_type === 'percentage' && selectedCoupon.discount_value) {
        price = Math.round(price * (1 - selectedCoupon.discount_value / 100));
      } else if (selectedCoupon.discount_type === 'special_price' && selectedCoupon.special_price !== null) {
        price = selectedCoupon.special_price;
      }
    }
    return price;
  };

  // Generate date options (next 30 days)
  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().split('T')[0];
  });

  const steps: { key: Step; label: string }[] = [
    { key: 'menu', label: 'メニュー' },
    { key: 'staff', label: 'スタッフ' },
    { key: 'date', label: '日時' },
    { key: 'time', label: '時間' },
    { key: 'info', label: '情報' },
    { key: 'confirm', label: '確認' },
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
            {i < steps.length - 1 && <div className="w-4 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step: Menu */}
      {step === 'menu' && (
        <div className="space-y-3">
          <h2 className="font-bold">メニューを選択</h2>
          {menus.map((menu) => (
            <button
              key={menu.id}
              onClick={() => { setSelectedMenu(menu); setStep('staff'); }}
              className={`w-full text-left p-4 rounded-xl border transition-colors ${
                selectedMenu?.id === menu.id ? 'border-primary bg-sky-50' : 'border-gray-200 hover:border-sky-300'
              }`}
            >
              <p className="font-bold text-sm">{menu.name}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                {menu.price !== null && <span>¥{menu.price.toLocaleString()}</span>}
                {menu.duration_minutes && <span>{menu.duration_minutes}分</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step: Staff */}
      {step === 'staff' && (
        <div className="space-y-3">
          <h2 className="font-bold">スタッフを選択</h2>
          <button
            onClick={() => { setSelectedStaff(staff[0] ?? null); setStep('date'); }}
            className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-sky-300"
          >
            <p className="font-bold text-sm">指名なし</p>
            <p className="text-xs text-gray-500">空いているスタッフが対応します</p>
          </button>
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelectedStaff(s); setStep('date'); }}
              className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-sky-300"
            >
              <p className="font-bold text-sm">{s.name}</p>
              {s.position && <p className="text-xs text-gray-500">{s.position}</p>}
            </button>
          ))}
          <button onClick={() => setStep('menu')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
        </div>
      )}

      {/* Step: Date */}
      {step === 'date' && (
        <div className="space-y-3">
          <h2 className="font-bold">日付を選択</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {dateOptions.map((date) => {
              const d = new Date(date);
              const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <button
                  key={date}
                  onClick={() => { setSelectedDate(date); setStep('time'); }}
                  className={`p-3 rounded-xl border text-center transition-colors ${
                    selectedDate === date ? 'border-primary bg-sky-50' : 'border-gray-200 hover:border-sky-300'
                  }`}
                >
                  <p className="text-xs text-gray-500">{d.getMonth() + 1}/{d.getDate()}</p>
                  <p className={`text-sm font-bold ${isWeekend ? 'text-red-500' : ''}`}>
                    {dayNames[d.getDay()]}
                  </p>
                </button>
              );
            })}
          </div>
          <button onClick={() => setStep('staff')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
        </div>
      )}

      {/* Step: Time */}
      {step === 'time' && (
        <div className="space-y-3">
          <h2 className="font-bold">時間を選択</h2>
          <p className="text-sm text-gray-500">{selectedDate}</p>
          {slotsLoading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : slots.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center">
              <p className="text-gray-400 text-sm">この日は予約可能な時間帯がありません</p>
              <button onClick={() => setStep('date')} className="mt-3 text-sm text-primary hover:underline">
                別の日付を選ぶ
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map((slot) => (
                <button
                  key={slot.slot_start}
                  onClick={() => { setSelectedSlot(slot); setStep('info'); }}
                  className="p-3 rounded-xl border border-gray-200 hover:border-sky-300 text-center"
                >
                  <p className="font-bold text-sm">{slot.slot_start.slice(0, 5)}</p>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setStep('date')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
        </div>
      )}

      {/* Step: Customer Info */}
      {step === 'info' && (
        <div className="space-y-4">
          <h2 className="font-bold">お客様情報</h2>
          <div>
            <label htmlFor="booking-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
            <input
              id="booking-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="form-input"
              placeholder="山田 太郎"
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
          <div className="flex gap-3">
            <button onClick={() => setStep('time')} className="text-sm text-gray-500 hover:underline">
              戻る
            </button>
            <button
              onClick={() => {
                if (!customerName || !email) {
                  setToast({ type: 'error', message: 'お名前とメールアドレスは必須です' });
                  return;
                }
                setStep('confirm');
              }}
              className="btn-primary flex-1 !py-3"
            >
              確認へ進む
            </button>
          </div>
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="font-bold">予約内容の確認</h2>
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">施設</span>
              <span className="font-medium">{facility.name}</span>
            </div>
            {selectedMenu && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">メニュー</span>
                <span className="font-medium">{selectedMenu.name}</span>
              </div>
            )}
            {selectedStaff && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">スタッフ</span>
                <span className="font-medium">{selectedStaff.name}</span>
              </div>
            )}
            {selectedCoupon && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">クーポン</span>
                <span className="font-medium text-red-500">{selectedCoupon.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">日時</span>
              <span className="font-medium">{selectedDate} {selectedSlot?.slot_start.slice(0, 5)}〜{selectedSlot?.slot_end.slice(0, 5)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">お名前</span>
              <span className="font-medium">{customerName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">メール</span>
              <span className="font-medium">{email}</span>
            </div>
            {phone && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">電話</span>
                <span className="font-medium">{phone}</span>
              </div>
            )}
            {calculatePrice() !== null && (
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="text-gray-500">合計金額</span>
                <span className="font-bold text-lg">¥{calculatePrice()!.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('info')} className="text-sm text-gray-500 hover:underline">
              戻る
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 !py-3"
            >
              {submitting ? '予約中...' : 'この内容で予約する'}
            </button>
          </div>
        </div>
      )}

      {/* Coupon selection (shown on menu step) */}
      {step === 'menu' && coupons.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold text-sm mb-2">クーポンを使う</h3>
          <div className="space-y-2">
            <button
              onClick={() => setSelectedCoupon(null)}
              className={`w-full text-left p-3 rounded-xl border text-sm ${
                !selectedCoupon ? 'border-primary bg-sky-50' : 'border-gray-200'
              }`}
            >
              クーポンなし
            </button>
            {coupons.map((coupon) => (
              <button
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

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
