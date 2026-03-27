'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface CalendarBooking {
  id: string;
  staff_name: string;
  staff_id: string;
  customer_name: string;
  menu_name: string;
  start_time: string;
  end_time: string;
  status: string;
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 9); // 9:00 - 22:00
const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-sky-500 text-white',
  pending: 'bg-amber-400 text-white',
  completed: 'bg-green-500 text-white',
  cancelled: 'bg-gray-300 text-gray-600',
};

export default function BookingCalendarPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
    if (!membership) return;

    const [staffRes, bookingRes] = await Promise.all([
      supabase.from('staff_profiles').select('id, name').eq('facility_id', membership.facility_id).eq('is_active', true).order('sort_order'),
      supabase.from('bookings').select('id, staff_id, customer_name, start_time, end_time, status, menu_id')
        .eq('facility_id', membership.facility_id).eq('booking_date', date).neq('status', 'cancelled'),
    ]);

    const staffData = staffRes.data || [];
    const bookingsData = bookingRes.data || [];

    // Get menu names
    const menuIds = Array.from(new Set(bookingsData.filter((b) => b.menu_id).map((b) => b.menu_id)));
    let menuMap: Record<string, string> = {};
    if (menuIds.length > 0) {
      const { data: menus } = await supabase.from('facility_menus').select('id, name').in('id', menuIds);
      menuMap = Object.fromEntries((menus || []).map((m) => [m.id, m.name]));
    }

    const staffMap = Object.fromEntries(staffData.map((s) => [s.id, s.name]));

    setStaffList(staffData);
    setBookings(bookingsData.map((b) => ({
      id: b.id,
      staff_id: b.staff_id || '',
      staff_name: b.staff_id ? staffMap[b.staff_id] || '不明' : '未指定',
      customer_name: b.customer_name,
      menu_name: b.menu_id ? menuMap[b.menu_id] || '' : '',
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status,
    })));
    setLoading(false);
  }, [date]);

  useEffect(() => { loadData().catch(() => setLoading(false)); }, [loadData]);

  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const navigateDate = (offset: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().slice(0, 10));
  };

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dateObj = new Date(date);
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日（${dayNames[dateObj.getDay()]}）`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">予約台帳</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateDate(-1)} aria-label="前日" className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          <button onClick={() => navigateDate(1)} aria-label="翌日" className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">{dateLabel}</p>

      {loading ? (
        <div className="animate-pulse"><div className="h-96 bg-gray-200 rounded-xl" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Header */}
            <div className="flex border-b">
              <div className="w-24 shrink-0 p-2 text-xs font-bold text-gray-500 border-r bg-gray-50">スタッフ</div>
              <div className="flex-1 flex">
                {HOURS.map((h) => (
                  <div key={h} className="flex-1 p-2 text-xs text-center text-gray-400 border-r">{h}:00</div>
                ))}
              </div>
            </div>

            {/* Staff rows */}
            {staffList.map((staff) => {
              const staffBookings = bookings.filter((b) => b.staff_id === staff.id);
              return (
                <div key={staff.id} className="flex border-b relative" style={{ height: '48px' }}>
                  <div className="w-24 shrink-0 p-2 text-xs font-medium text-gray-700 border-r bg-gray-50 flex items-center">{staff.name}</div>
                  <div className="flex-1 relative">
                    {/* Grid lines */}
                    <div className="absolute inset-0 flex">
                      {HOURS.map((h) => <div key={h} className="flex-1 border-r border-gray-100" />)}
                    </div>
                    {/* Booking blocks */}
                    {staffBookings.map((b) => {
                      const startMin = timeToMinutes(b.start_time) - 9 * 60;
                      const endMin = timeToMinutes(b.end_time) - 9 * 60;
                      const totalMin = 14 * 60;
                      const left = `${(startMin / totalMin) * 100}%`;
                      const width = `${((endMin - startMin) / totalMin) * 100}%`;
                      return (
                        <div
                          key={b.id}
                          className={`absolute top-1 bottom-1 rounded px-1.5 text-micro overflow-hidden cursor-pointer hover:opacity-90 ${STATUS_COLORS[b.status] || 'bg-gray-200'}`}
                          style={{ left, width }}
                          title={`${b.customer_name} - ${b.menu_name} (${b.start_time.slice(0, 5)}〜${b.end_time.slice(0, 5)})`}
                        >
                          <span className="font-bold">{b.customer_name}</span>
                          <span className="ml-1">{b.start_time.slice(0, 5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {staffList.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">スタッフが登録されていません</div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500" />確定</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" />仮予約</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" />完了</span>
      </div>
    </div>
  );
}
