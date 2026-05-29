'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import {
  SALON_OPEN_HOUR,
  SALON_CLOSE_HOUR,
  hoursRange,
  blockPosition,
  layoutRow,
  offsetToTime,
  nowLinePosition,
  formatDateLabel,
  shiftDate,
} from '@/lib/salon-board';
import { getTodayString } from '@/lib/validations-booking';
import BookingModal, { type ModalInit, type StaffOption, type MenuOption, type BoardBooking } from './BookingModal';

const HOURS = hoursRange();
const ROW_HEIGHT = 56; // px

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-sky-500 text-white border-sky-600',
  pending: 'bg-amber-400 text-white border-amber-500',
  completed: 'bg-emerald-500 text-white border-emerald-600',
  no_show: 'bg-rose-400 text-white border-rose-500',
  cancelled: 'bg-gray-300 text-gray-600 border-gray-400',
};

function statusStyle(status: string): string {
  return STATUS_STYLE[status] ?? 'bg-gray-200 text-gray-700 border-gray-300';
}

export default function SalonBoard({ facilityId }: { facilityId: string }) {
  const [date, setDate] = useState(() => getTodayString());
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [menuList, setMenuList] = useState<MenuOption[]>([]);
  const [bookings, setBookings] = useState<BoardBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalInit | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const [staffRes, menuRes, bookingRes] = await Promise.all([
      supabase.from('staff_profiles').select('id, name').eq('facility_id', facilityId).eq('is_active', true).order('sort_order'),
      supabase.from('facility_menus').select('id, name, duration_minutes, price').eq('facility_id', facilityId).order('sort_order'),
      supabase.from('bookings')
        .select('id, staff_id, menu_id, customer_name, email, phone, note, start_time, end_time, status, source, total_price')
        .eq('facility_id', facilityId).eq('booking_date', date).neq('status', 'cancelled'),
    ]);
    setStaffList((staffRes.data as StaffOption[]) ?? []);
    setMenuList((menuRes.data as MenuOption[]) ?? []);
    setBookings((bookingRes.data as BoardBooking[]) ?? []);
    setLoading(false);
  }, [facilityId, date]);

  useEffect(() => { loadData().catch(() => setLoading(false)); }, [loadData]);

  // 現在時刻ライン（今日のみ）
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      setNowMinutes(jst.getUTCHours() * 60 + jst.getUTCMinutes());
    };
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  const menuName = (menuId: string | null) => menuList.find((m) => m.id === menuId)?.name ?? '';

  const handleSaved = (message: string) => {
    setModal(null);
    setToast({ type: 'success', message });
    loadData().catch(() => {});
  };

  const handleCellClick = (staffId: string | null, e: React.MouseEvent<HTMLDivElement>) => {
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const start = offsetToTime(offsetX, rect.width, SALON_OPEN_HOUR, SALON_CLOSE_HOUR);
    setModal({ mode: 'create', staffId, startTime: start });
  };

  const isToday = date === getTodayString();
  const nowPct = isToday && nowMinutes !== null ? nowLinePosition(nowMinutes) : null;

  // 指名なしの予約も1行で表示する
  const rows: { id: string | null; name: string }[] = [
    ...staffList.map((s) => ({ id: s.id as string | null, name: s.name })),
    { id: null, name: '指名なし' },
  ];

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold mr-2">サロンボード</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="前日" className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <button type="button" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="翌日" className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <button type="button" onClick={() => setDate(getTodayString())} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">今日</button>
        <span className="text-sm text-gray-600">{formatDateLabel(date)}</span>
        <div className="flex-1" />
        <Link href="/admin/bookings" className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">予約一覧</Link>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create', staffId: staffList[0]?.id ?? null, startTime: `${String(SALON_OPEN_HOUR).padStart(2, '0')}:00` })}
          className="px-4 py-2 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-lg"
        >
          ＋予約登録
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse"><div className="h-96 bg-gray-200 rounded-xl" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <div className="min-w-[860px]">
            {/* 時間ヘッダー */}
            <div className="flex border-b sticky top-0 bg-white z-10">
              <div className="w-28 shrink-0 p-2 text-xs font-bold text-gray-500 border-r bg-gray-50">スタッフ</div>
              <div className="flex-1 flex">
                {HOURS.map((h) => (
                  <div key={h} className="flex-1 p-2 text-xs text-center text-gray-400 border-r">{h}:00</div>
                ))}
              </div>
            </div>

            {/* スタッフ行 */}
            {rows.map((row) => {
              const rowBookings = bookings.filter((b) => (b.staff_id ?? null) === row.id);
              const laid = layoutRow(rowBookings);
              const rowKey = row.id ?? '__none__';
              return (
                <div key={rowKey} className="flex border-b relative" style={{ height: `${ROW_HEIGHT}px` }}>
                  <div className="w-28 shrink-0 p-2 text-xs font-medium text-gray-700 border-r bg-gray-50 flex items-center">{row.name}</div>
                  <div
                    className="flex-1 relative cursor-pointer"
                    ref={(el) => { trackRefs.current[rowKey] = el; }}
                    onClick={(e) => handleCellClick(row.id, e)}
                  >
                    {/* グリッド線 */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {HOURS.map((h) => <div key={h} className="flex-1 border-r border-gray-100" />)}
                    </div>
                    {/* 現在時刻ライン */}
                    {nowPct !== null && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-20" style={{ left: `${nowPct}%` }} />
                    )}
                    {/* 予約ブロック */}
                    {laid.map(({ item, lane, laneCount }) => {
                      const { leftPct, widthPct } = blockPosition(item.start_time, item.end_time);
                      const laneH = 100 / laneCount;
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={(e) => { e.stopPropagation(); setModal({ mode: 'edit', booking: item }); }}
                          className={`absolute rounded px-1.5 py-0.5 text-[11px] leading-tight overflow-hidden border text-left hover:opacity-90 z-10 ${statusStyle(item.status)}`}
                          style={{
                            left: `${leftPct}%`,
                            width: `calc(${widthPct}% - 2px)`,
                            top: `${lane * laneH}%`,
                            height: `calc(${laneH}% - 2px)`,
                          }}
                          title={`${item.customer_name} ${item.start_time.slice(0, 5)}〜${item.end_time.slice(0, 5)} ${menuName(item.menu_id)}`}
                        >
                          <span className="font-bold">{item.customer_name}</span>
                          <span className="ml-1 opacity-90">{item.start_time.slice(0, 5)}</span>
                          {menuName(item.menu_id) && <span className="ml-1 opacity-80 hidden sm:inline">{menuName(item.menu_id)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {staffList.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">
                スタッフが登録されていません。<Link href="/admin/staff" className="text-sky-600 underline">スタッフ管理</Link>から登録してください。
              </div>
            )}
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500" />確定</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" />仮予約</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" />完了</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-400" />無断キャンセル</span>
        <span className="ml-2 text-gray-400">空き枠をクリックで予約登録 / 予約をクリックで編集</span>
      </div>

      {modal && (
        <BookingModal
          init={modal}
          facilityId={facilityId}
          date={date}
          staffList={staffList}
          menuList={menuList}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onError={(message) => setToast({ type: 'error', message })}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
