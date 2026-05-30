'use client';

import { useState } from 'react';
import Link from 'next/link';
import { computeEndTime, addMinutes } from '@/lib/salon-board';

export interface StaffOption {
  id: string;
  name: string;
}

export interface MenuOption {
  id: string;
  name: string;
  duration_minutes: number | null;
  price: number | null;
}

export interface BoardBooking {
  id: string;
  staff_id: string | null;
  menu_id: string | null;
  customer_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  start_time: string;
  end_time: string;
  status: string;
  source: string;
  total_price: number | null;
}

interface CreateInit {
  mode: 'create';
  staffId: string | null;
  startTime: string;
}

interface EditInit {
  mode: 'edit';
  booking: BoardBooking;
}

export type ModalInit = CreateInit | EditInit;

interface Props {
  init: ModalInit;
  facilityId: string;
  date: string;
  staffList: StaffOption[];
  menuList: MenuOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'confirmed', label: '確定' },
  { value: 'completed', label: '完了' },
  { value: 'no_show', label: '無断キャンセル' },
  { value: 'cancelled', label: 'キャンセル' },
];

const STEP_LABELS = ['メニュー', '日時・担当', 'お客様', '確認'];

export default function BookingModal({ init, facilityId, date, staffList, menuList, onClose, onSaved, onError }: Props) {
  const isEdit = init.mode === 'edit';
  const initial = isEdit ? init.booking : null;

  const [customerName, setCustomerName] = useState(initial?.customer_name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [staffId, setStaffId] = useState<string>(isEdit ? (initial?.staff_id ?? '') : (init.staffId ?? ''));
  const [menuId, setMenuId] = useState<string>(initial?.menu_id ?? '');
  const [startTime, setStartTime] = useState(isEdit ? (initial?.start_time.slice(0, 5) ?? '') : init.startTime);
  const [endTime, setEndTime] = useState(isEdit ? (initial?.end_time.slice(0, 5) ?? '') : computeEndTime(init.startTime, 60));
  const [note, setNote] = useState(initial?.note ?? '');
  const [source, setSource] = useState<'walk_in' | 'phone'>(initial?.source === 'phone' ? 'phone' : 'walk_in');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1); // create のみ使用

  const menuName = (id: string) => menuList.find((m) => m.id === id)?.name ?? '未選択';
  const staffName = (id: string) => staffList.find((s) => s.id === id)?.name ?? '指名なし';

  const handleMenuChange = (newMenuId: string) => {
    setMenuId(newMenuId);
    const menu = menuList.find((m) => m.id === newMenuId);
    if (menu?.duration_minutes && startTime) setEndTime(computeEndTime(startTime, menu.duration_minutes));
  };

  const handleStartChange = (newStart: string) => {
    setStartTime(newStart);
    const menu = menuList.find((m) => m.id === menuId);
    setEndTime(computeEndTime(newStart, menu?.duration_minutes ?? 60));
  };

  const submit = async () => {
    if (saving) return;
    if (!customerName.trim()) { onError('お名前を入力してください'); return; }
    if (startTime >= endTime) { onError('開始時刻は終了時刻より前にしてください'); return; }
    setSaving(true);
    try {
      const url = isEdit ? '/api/admin/booking-update' : `/api/admin/booking-create?facility_id=${facilityId}`;
      const payload = isEdit
        ? { booking_id: initial!.id, staff_id: staffId || null, menu_id: menuId || null, booking_date: date, start_time: startTime, end_time: endTime, customer_name: customerName.trim(), email, phone, note }
        : { staff_id: staffId || null, menu_id: menuId || null, booking_date: date, start_time: startTime, end_time: endTime, customer_name: customerName.trim(), email, phone, note, source };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { onError(data.error || '保存に失敗しました'); setSaving(false); return; }
      onSaved(isEdit ? '予約を更新しました' : '予約を登録しました');
    } catch {
      onError('通信エラーが発生しました'); setSaving(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (saving || !initial) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/booking-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: initial.id, status }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { onError(data.error || 'ステータス変更に失敗しました'); setSaving(false); return; }
      onSaved('ステータスを変更しました');
    } catch {
      onError('通信エラーが発生しました'); setSaving(false);
    }
  };

  const next = () => {
    if (step === 3 && !customerName.trim()) { onError('お名前を入力してください'); return; }
    if (step === 2 && startTime >= endTime) { onError('開始時刻は終了時刻より前にしてください'); return; }
    setStep((s) => Math.min(4, s + 1));
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm';
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold">{isEdit ? '予約の編集' : '予約登録'}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 新規＝ステップバー */}
        {!isEdit && (
          <div className="flex items-center justify-center gap-1 px-5 py-3 border-b bg-gray-50">
            {STEP_LABELS.map((lbl, i) => (
              <div key={lbl} className="flex items-center">
                <div className="flex flex-col items-center">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i + 1 <= step ? 'bg-sky-500 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</span>
                  <span className={`text-[10px] mt-0.5 ${i + 1 === step ? 'text-sky-600 font-bold' : 'text-gray-400'}`}>{lbl}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <span className={`w-6 h-0.5 mx-0.5 mb-3 ${i + 1 < step ? 'bg-sky-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* ===== 新規：ステップ式 ===== */}
          {!isEdit && step === 1 && (
            <div>
              <label className={labelCls}>メニュー</label>
              <div className="space-y-2">
                {menuList.length === 0 && <p className="text-sm text-gray-400">メニュー未登録（後で選択可）</p>}
                {menuList.map((m) => (
                  <button key={m.id} type="button" onClick={() => handleMenuChange(m.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm flex justify-between items-center ${menuId === m.id ? 'border-sky-400 bg-sky-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <span>{m.name}{m.duration_minutes ? `（${m.duration_minutes}分）` : ''}</span>
                    {m.price != null && <span className="text-gray-500">¥{m.price.toLocaleString()}</span>}
                  </button>
                ))}
                <button type="button" onClick={() => setMenuId('')}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${menuId === '' ? 'border-sky-400 bg-sky-50' : 'border-gray-200 hover:bg-gray-50'}`}>未選択のまま進む</button>
              </div>
            </div>
          )}

          {!isEdit && step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>開始</label><input type="time" value={startTime} onChange={(e) => handleStartChange(e.target.value)} step={300} className={inputCls} /></div>
                <div><label className={labelCls}>終了</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} step={300} className={inputCls} /></div>
              </div>
              <div className="flex gap-2 text-xs">
                {[30, 60, 90].map((mm) => <button key={mm} type="button" onClick={() => setEndTime(addMinutes(startTime, mm))} className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">+{mm}分</button>)}
              </div>
              <div>
                <label className={labelCls}>担当スタッフ</label>
                <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={`${inputCls} bg-white`}>
                  <option value="">指名なし</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>予約経路</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSource('walk_in')} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${source === 'walk_in' ? 'bg-sky-50 border-sky-400 text-sky-700' : 'border-gray-200 text-gray-600'}`}>店頭</button>
                  <button type="button" onClick={() => setSource('phone')} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${source === 'phone' ? 'bg-sky-50 border-sky-400 text-sky-700' : 'border-gray-200 text-gray-600'}`}>電話</button>
                </div>
              </div>
            </>
          )}

          {!isEdit && step === 3 && (
            <>
              <div>
                <label className={labelCls}>お客様名 <span className="text-red-500">*</span></label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} placeholder="山田 花子" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>電話</label><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="090-1234-5678" /></div>
                <div><label className={labelCls}>メール（任意）</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="任意" /></div>
              </div>
              <div><label className={labelCls}>備考</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} /></div>
            </>
          )}

          {!isEdit && step === 4 && (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-gray-400 mb-2">内容を確認して登録してください</p>
              {[['お客様', `${customerName || '—'} 様`], ['メニュー', menuName(menuId)], ['日時', `${date} ${startTime}〜${endTime}`], ['担当', staffName(staffId)], ['経路', source === 'walk_in' ? '店頭' : '電話'], ['備考', note || '—']].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-gray-100 py-1.5"><span className="text-gray-500">{k}</span><span className="font-medium text-right">{v}</span></div>
              ))}
            </div>
          )}

          {/* ===== 編集：単一フォーム ===== */}
          {isEdit && (
            <>
              <div><label className={labelCls}>お客様名 <span className="text-red-500">*</span></label><input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>電話</label><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>メール（任意）</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>担当スタッフ</label><select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={`${inputCls} bg-white`}><option value="">指名なし</option>{staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className={labelCls}>メニュー</label><select value={menuId} onChange={(e) => handleMenuChange(e.target.value)} className={`${inputCls} bg-white`}><option value="">未選択</option>{menuList.map((m) => <option key={m.id} value={m.id}>{m.name}{m.duration_minutes ? `（${m.duration_minutes}分）` : ''}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>開始</label><input type="time" value={startTime} onChange={(e) => handleStartChange(e.target.value)} step={300} className={inputCls} /></div>
                <div><label className={labelCls}>終了</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} step={300} className={inputCls} /></div>
              </div>
              <div className="flex gap-2 text-xs">{[30, 60, 90].map((mm) => <button key={mm} type="button" onClick={() => setEndTime(addMinutes(startTime, mm))} className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">+{mm}分</button>)}</div>
              <div><label className={labelCls}>備考</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} /></div>
              <div className="border-t pt-4">
                <p className="text-xs text-gray-500 mb-2">ステータス変更（お客様へ通知されます）</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((s) => (
                    <button key={s.value} type="button" onClick={() => changeStatus(s.value)} disabled={saving || initial!.status === s.value}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-40 ${initial!.status === s.value ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{s.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t flex items-center gap-3 sticky bottom-0 bg-white">
          {isEdit && <Link href={`/admin/bookings/${initial!.id}`} className="text-sm text-gray-500 hover:text-primary">詳細</Link>}
          {!isEdit && step > 1 && <button type="button" onClick={() => setStep((s) => s - 1)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">戻る</button>}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
          {isEdit && <button type="button" onClick={submit} disabled={saving} className="px-5 py-2 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-lg disabled:opacity-50">{saving ? '保存中…' : '更新する'}</button>}
          {!isEdit && step < 4 && <button type="button" onClick={next} className="px-5 py-2 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-lg">次へ</button>}
          {!isEdit && step === 4 && <button type="button" onClick={submit} disabled={saving} className="px-5 py-2 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-lg disabled:opacity-50">{saving ? '登録中…' : '登録する'}</button>}
        </div>
      </div>
    </div>
  );
}
