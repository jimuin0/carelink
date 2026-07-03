'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import AdjustRequestButtons from '@/components/admin/AdjustRequestButtons';
import type { Booking } from '@/types';
import { statusBannerClass, bookingStatusLabel, getAllowedStatusTransitions } from '@/lib/booking-status';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

// 退店レジ会計の明細行（/api/admin/booking-checkout と整合）
type ChargeType = 'menu' | 'retail' | 'discount';
type Charge = { type: ChargeType; name: string; amount: number };
const CHARGE_TYPE_LABEL: Record<ChargeType, string> = { menu: 'メニュー', retail: '物販', discount: '割引' };
// 会計できるのは確定/受付の予約のみ（API 側の前提と一致）
const CHECKOUTABLE = ['confirmed', 'arrived'];
// 顧客へ「キャンセル/無断キャンセル」の否定的な通知メールが即送信される破壊的遷移。
// 毎日触る画面でミスタップ1回が実顧客への誤送信＋取消不能になるため、実行前に確認を挟む
// （承認・来店などの非破壊/肯定的遷移は従来どおり即時実行）。
const CONFIRM_STATUSES = ['cancelled', 'no_show'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

export default function AdminBookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [menuName, setMenuName] = useState<string | null>(null);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  // 退店レジ会計
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutItems, setCheckoutItems] = useState<Charge[]>([]);
  const [paid, setPaid] = useState('');

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: membership, error: memErr } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (!membership) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .eq('facility_id', membership.facility_id)
        .single();

      // PGRST116（行なし）は真の「見つからない」として下の not-found 表示に委ねる。
      // それ以外（通信/権限エラー）は「見つかりません」に偽装せず失敗として明示する。
      if (error && error.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (data) {
        setBooking(data as Booking);
        if (data.menu_ids && data.menu_ids.length > 1) {
          // 複数メニュー予約は menu_ids の全メニュー名を「、」で連結表示（A6・menu_id 単独だと1件目のみ）。
          // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
          const { data: menus } = await supabase.from('facility_menus').select('name').in('id', data.menu_ids);
          if (menus && menus.length > 0) setMenuName(menus.map((m) => m.name).join('、'));
        } else if (data.menu_id) {
          // メニュー名は補助表示。取得失敗時は名称未表示で予約詳細本体は継続表示する。
          // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
          const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', data.menu_id).single();
          if (menu) setMenuName(menu.name);
        }
        if (data.staff_id) {
          // 担当スタッフ名は補助表示。取得失敗時は名称未表示で予約詳細本体は継続表示する。
          // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
          const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', data.staff_id).single();
          if (staff) setStaffName(staff.name);
        }
      }
      setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load().catch(() => { setLoadError(true); setLoading(false); });
  }, [load]);

  const handleStatusChange = async (newStatus: string) => {
    if (updating || !booking) return;
    setUpdating(true);

    try {
      const res = await fetch('/api/admin/booking-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        setToast({ type: 'error', message: data.error || '更新に失敗しました' });
      } else {
        setBooking((prev) => prev ? { ...prev, status: newStatus as Booking['status'] } : null);
        const label = bookingStatusLabel(newStatus);
        setToast({ type: 'success', message: `ステータスを「${label}」に変更し、お客様に通知しました` });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setUpdating(false);
    }
  };

  // 破壊的遷移(cancelled/no_show)は確認ダイアログを挟み、それ以外は即時実行する。
  const requestStatusChange = (newStatus: string) => {
    if (CONFIRM_STATUSES.includes(newStatus)) { setPendingStatus(newStatus); return; }
    handleStatusChange(newStatus);
  };

  // ── 退店レジ会計 ──
  const openCheckout = () => {
    if (!booking) return;
    setCheckoutItems([{ type: 'menu', name: menuName || '施術', amount: booking.total_price ?? 0 }]);
    setPaid('');
    setCheckoutOpen(true);
  };
  const updateItem = (i: number, patch: Partial<Charge>) =>
    setCheckoutItems((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addItem = (type: ChargeType) =>
    setCheckoutItems((prev) => [...prev, { type, name: type === 'discount' ? '割引' : '', amount: 0 }]);
  const removeItem = (i: number) =>
    setCheckoutItems((prev) => prev.filter((_, idx) => idx !== i));

  const checkoutTotal = Math.max(
    0,
    checkoutItems.reduce((s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0), 0),
  );
  const paidNum = paid.trim() === '' || !Number.isFinite(Number(paid)) ? null : Math.floor(Number(paid));
  const change = paidNum !== null ? paidNum - checkoutTotal : null;

  const handleCheckout = async () => {
    if (updating || !booking) return;
    if (checkoutItems.length === 0) {
      setToast({ type: 'error', message: '明細を1件以上入力してください' });
      return;
    }
    setUpdating(true);
    try {
      const res = await fetch('/api/admin/booking-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          items: checkoutItems.map((c) => ({
            type: c.type,
            name: c.name.trim() || CHARGE_TYPE_LABEL[c.type],
            amount: Math.floor(c.amount) || 0,
          })),
          paid_amount: paidNum,
          complete: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: 'error', message: data.error || '会計に失敗しました' });
      } else {
        setBooking((prev) => (prev ? { ...prev, status: 'completed', total_price: data.total_price } : null));
        setCheckoutOpen(false);
        setToast({ type: 'success', message: `会計を確定して完了しました（¥${(data.total_price ?? 0).toLocaleString()}）` });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <AdminPageLoading />;

  if (loadError) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/bookings" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <h1 className="text-2xl font-bold">予約詳細</h1>
        </div>
        <LoadError onRetry={load} message="予約の読み込みに失敗しました" />
      </div>
    );
  }

  if (!booking) {
    return <div className="bg-white rounded-xl p-8 text-center"><p className="text-gray-400">予約が見つかりません</p></div>;
  }

  const banner = statusBannerClass(booking.status);
  // 現在状態から手動で遷移可能なステータスのみをボタン化（UI/API 共有の SSOT を参照）。
  const allowedNextStatuses = getAllowedStatusTransitions(booking.status);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/bookings" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <h1 className="text-2xl font-bold">予約詳細</h1>
        <span className={`ml-auto text-xs font-bold px-3 py-1 rounded-full border ${banner.bg} ${banner.text}`}>{bookingStatusLabel(booking.status)}</span>
      </div>

      {/* 承認アクション（pending時） */}
      {booking.status === 'pending' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-bold text-amber-800 mb-3">この予約を承認しますか？</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleStatusChange('confirmed')}
              disabled={updating}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {updating ? '処理中...' : '承認する'}
            </button>
            <button
              type="button"
              onClick={() => requestStatusChange('cancelled')}
              disabled={updating}
              className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              お断りする
            </button>
          </div>
          <p className="text-xs text-amber-600 mt-2">※ステータス変更時にお客様へメールが自動送信されます</p>
        </div>
      )}

      {/* 退店レジ会計（確定/受付の予約のみ） */}
      {CHECKOUTABLE.includes(booking.status) && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-6">
          {!checkoutOpen ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-emerald-800">退店・お会計</p>
                <p className="text-xs text-emerald-600 mt-0.5">当日のメニュー・物販・割引を確定し、会計を締めて完了にします</p>
              </div>
              <button
                type="button"
                onClick={openCheckout}
                disabled={updating}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                会計する
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-emerald-800">退店・お会計</p>
              <div className="space-y-2">
                {checkoutItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={item.type}
                      onChange={(e) => updateItem(i, { type: e.target.value as ChargeType })}
                      className="text-xs border border-gray-300 rounded-lg px-2 py-2 bg-white"
                      aria-label="種別"
                    >
                      <option value="menu">メニュー</option>
                      <option value="retail">物販</option>
                      <option value="discount">割引</option>
                    </select>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2"
                      aria-label={CHARGE_TYPE_LABEL[item.type] + '名'}
                    />
                    <input
                      type="number"
                      value={Number.isFinite(item.amount) ? item.amount : 0}
                      onChange={(e) => {
                        const v = Math.floor(Number(e.target.value)) || 0;
                        updateItem(i, { amount: item.type === 'discount' ? -Math.abs(v) : v });
                      }}
                      className="w-28 text-sm text-right border border-gray-300 rounded-lg px-3 py-2"
                      aria-label="金額"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-gray-400 hover:text-red-500 px-1"
                      aria-label="行を削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => addItem('retail')} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-100">＋物販</button>
                <button type="button" onClick={() => addItem('discount')} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-100">＋割引</button>
              </div>
              <div className="border-t border-emerald-200 pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-emerald-900">合計</span>
                  <span className="font-bold text-lg text-emerald-700">¥{checkoutTotal.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">お預かり</span>
                  <input
                    type="number"
                    value={paid}
                    onChange={(e) => setPaid(e.target.value)}
                    className="w-32 text-sm text-right border border-gray-300 rounded-lg px-3 py-2"
                    aria-label="お預かり金額（任意）"
                  />
                </div>
                {change !== null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">お釣り</span>
                    <span className={`font-bold ${change < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                      {change < 0 ? `不足 ¥${Math.abs(change).toLocaleString()}` : `¥${change.toLocaleString()}`}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={updating}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  {updating ? '処理中...' : '会計を確定して完了'}
                </button>
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(false)}
                  disabled={updating}
                  className="px-4 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 予約情報 */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">お客様名</p>
            <p className="font-medium text-base">{booking.customer_name}</p>
          </div>
          <div>
            <p className="text-gray-500">メール</p>
            <p className="font-medium">{booking.email}</p>
          </div>
          <div>
            <p className="text-gray-500">日時</p>
            <p className="font-medium">{formatDate(booking.booking_date)}</p>
            <p className="text-sky-600 font-bold">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</p>
          </div>
          {booking.phone && (
            <div>
              <p className="text-gray-500">電話</p>
              <p className="font-medium">{booking.phone}</p>
            </div>
          )}
          {menuName && (
            <div>
              <p className="text-gray-500">メニュー</p>
              <p className="font-medium">{menuName}</p>
            </div>
          )}
          {staffName && (
            <div>
              <p className="text-gray-500">担当スタッフ</p>
              <p className="font-medium">{staffName}</p>
            </div>
          )}
          {booking.total_price !== null && (
            <div>
              <p className="text-gray-500">金額</p>
              <p className="font-bold text-lg text-sky-600">¥{booking.total_price.toLocaleString()}</p>
            </div>
          )}
        </div>

        {booking.note && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500">備考</p>
            <p className="text-sm mt-1 bg-gray-50 p-3 rounded-lg">{booking.note}</p>
          </div>
        )}

        {/* ステータス変更（承認後）。現在状態から実際に遷移可能なステータスだけをボタン化する
            （遷移ルールは API と共有の SSOT＝booking-status.ts の ALLOWED_STATUS_TRANSITIONS）。
            到達不可なステータス（pending・cancel_fee_paid 等）は出さず、押すと必ず 400 になる
            死にボタンを構造的に排除する。遷移先が無い終端状態（cancelled / cancel_fee_paid）では
            セクションごと非表示にする。 */}
        {booking.status !== 'pending' && allowedNextStatuses.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500 mb-2">ステータス変更</p>
            <div className="flex flex-wrap gap-2">
              {allowedNextStatuses.map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => requestStatusChange(value)}
                  disabled={updating}
                  className="text-xs px-4 py-2 rounded-full font-bold transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                >
                  {bookingStatusLabel(value)}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">※変更時にお客様へメール通知されます</p>
          </div>
        )}
      </div>

      {/* 時間調整のお願い（メール無料/LINE有料オプション） */}
      <AdjustRequestButtons bookingId={booking.id} status={booking.status} />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={pendingStatus !== null}
        title={pendingStatus === 'no_show' ? '無断キャンセルにする' : '予約をキャンセルする'}
        message={
          pendingStatus === 'no_show'
            ? `${booking.customer_name}様を「無断キャンセル」にし、お客様へ通知メールを送信します。この操作は取り消せません。よろしいですか？`
            : `${booking.customer_name}様の予約をキャンセルし、お客様へキャンセル通知メールを送信します。この操作は取り消せません。よろしいですか？`
        }
        confirmLabel={pendingStatus === 'no_show' ? '無断キャンセルにする' : 'キャンセルする'}
        cancelLabel="やめる"
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); if (s) handleStatusChange(s); }}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  );
}
