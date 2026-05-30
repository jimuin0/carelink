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
const SHOP_OPEN_MIN = 10 * 60;  // 受付時間（外側はグレー網掛け）
const SHOP_CLOSE_MIN = 19 * 60;
const ROW_H = 46;
const QUARTER_W = 20; // px：15分セル幅
const LABEL_W = 140;  // px：左スタッフ列幅

const STATUS_STYLE: Record<string, { block: string; bar: string }> = {
  confirmed: { block: 'bg-sky-50 border-sky-300 text-sky-900', bar: 'bg-sky-400' },
  pending: { block: 'bg-amber-50 border-amber-300 text-amber-900', bar: 'bg-amber-400' },
  completed: { block: 'bg-emerald-50 border-emerald-300 text-emerald-900', bar: 'bg-emerald-500' },
  no_show: { block: 'bg-rose-50 border-rose-300 text-rose-900', bar: 'bg-rose-400' },
  cancelled: { block: 'bg-gray-100 border-gray-300 text-gray-500', bar: 'bg-gray-300' },
};
function statusStyle(status: string) {
  return STATUS_STYLE[status] ?? { block: 'bg-gray-50 border-gray-300 text-gray-700', bar: 'bg-gray-300' };
}
const STATUS_LABEL: Record<string, string> = {
  confirmed: '確定', pending: '仮予約', completed: '完了', no_show: '無断ｷｬﾝｾﾙ', cancelled: 'ｷｬﾝｾﾙ',
};
const NAV =['予約管理', '掲載管理', 'お客様管理', '売上管理', '集計・分析', '設定'];

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'staff'; id: string; name: string; sub: string }
  | { kind: 'free'; name: string; sub: string };

export default function SalonBoard({ facilityId }: { facilityId: string }) {
  const [date, setDate] = useState(() => getTodayString());
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [menuList, setMenuList] = useState<MenuOption[]>([]);
  const [bookings, setBookings] = useState<BoardBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalInit | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [showLegend, setShowLegend] = useState(false);
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [staffFilter, setStaffFilter] = useState<string>('');
  const [tab, setTab] = useState<'schedule' | 'list' | 'accept' | 'suspend'>('schedule');
  const [listFilter, setListFilter] = useState<string>('all');
  const [priorKeys, setPriorKeys] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<'reservation' | 'customers' | 'listing' | 'sales' | 'settings'>('reservation');
  const [sales, setSales] = useState<{ monthCount: number; monthSum: number; todayCount: number; todaySum: number; byDay: Record<string, { c: number; s: number }> } | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [customers, setCustomers] = useState<{ key: string; name: string; email: string | null; phone: string | null; count: number; last: string }[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [custSearchVisit, setCustSearchVisit] = useState('');
  const [custSearchSince, setCustSearchSince] = useState('');
  const [custDetail, setCustDetail] = useState<{
    name: string; email: string | null; phone: string | null; loading: boolean;
    totalSum: number; profile: { birth_date: string | null; gender: string | null; prefecture: string | null; city: string | null } | null;
    rows: { id: string; booking_date: string; start_time: string; end_time: string; menu_id: string | null; staff_id: string | null; status: string; total_price: number | null }[];
  } | null>(null);

  const openCustomerHistory = async (c: { key: string; name: string; email: string | null; phone: string | null }) => {
    setCustDetail({ name: c.name, email: c.email, phone: c.phone, loading: true, totalSum: 0, profile: null, rows: [] });
    const supabase = createBrowserSupabaseClient();
    let q = supabase.from('bookings').select('id, booking_date, start_time, end_time, menu_id, staff_id, status, total_price').eq('facility_id', facilityId).neq('status', 'cancelled').order('booking_date', { ascending: false });
    q = c.email ? q.eq('email', c.email) : q.eq('customer_name', c.name);
    const [bk, pr] = await Promise.all([
      q,
      c.email ? supabase.from('profiles').select('birth_date, gender, prefecture, city').eq('email', c.email).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const rows = (bk.data as { id: string; booking_date: string; start_time: string; end_time: string; menu_id: string | null; staff_id: string | null; status: string; total_price: number | null }[]) ?? [];
    const totalSum = rows.filter((r) => r.status === 'confirmed' || r.status === 'completed').reduce((s, r) => s + (r.total_price ?? 0), 0);
    setCustDetail({ name: c.name, email: c.email, phone: c.phone, loading: false, totalSum, profile: (pr.data as { birth_date: string | null; gender: string | null; prefecture: string | null; city: string | null } | null) ?? null, rows });
  };
  const [listing, setListing] = useState<{ name: string; status: string; staff: number; photos: number; menus: number } | null>(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [acceptStatus, setAcceptStatus] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYM, setPickerYM] = useState(() => getTodayString().slice(0, 7)); // 左側に表示する月 YYYY-MM
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  const fetchAcceptStatus = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase.from('facility_profiles').select('status').eq('id', facilityId).maybeSingle();
    setAcceptStatus((data as { status: string } | null)?.status ?? 'draft');
  }, [facilityId]);

  const toggleAccept = async (action: 'suspend' | 'resume') => {
    if (acceptBusy) return;
    setAcceptBusy(true);
    try {
      const res = await fetch(`/api/admin/facility-status?facility_id=${facilityId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setToast({ type: 'error', message: data.error || '更新に失敗しました' }); setAcceptBusy(false); return; }
      setAcceptStatus(data.status);
      setToast({ type: 'success', message: action === 'suspend' ? 'ネット予約の受付を停止しました' : 'ネット予約の受付を再開しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally { setAcceptBusy(false); }
  };
  const openDatePicker = () => {
    setPickerYM(date.slice(0, 7));
    const r = dateBtnRef.current?.getBoundingClientRect();
    if (r) setPickerPos({ top: r.bottom + 4, left: r.left });
    setShowPicker((s) => !s);
  };
  // 月文字列(YYYY-MM)を delta ヶ月ずらす
  const shiftYM = (ym: string, delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // 新規（初回来店）判定キー
  const custKey = (b: { email: string | null; customer_name: string }) =>
    (b.email || b.customer_name || '').toLowerCase();

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const [staffRes, menuRes, bookingRes, priorRes] = await Promise.all([
      supabase.from('staff_profiles').select('id, name, position').eq('facility_id', facilityId).eq('is_active', true).order('sort_order'),
      supabase.from('facility_menus').select('id, name, duration_minutes, price').eq('facility_id', facilityId).order('sort_order'),
      supabase.from('bookings')
        .select('id, staff_id, menu_id, customer_name, email, phone, note, start_time, end_time, status, source, total_price')
        .eq('facility_id', facilityId).eq('booking_date', date).neq('status', 'cancelled'),
      // 当日より前の来店履歴（新規=初回来店 判定用）
      supabase.from('bookings').select('email, customer_name')
        .eq('facility_id', facilityId).lt('booking_date', date).neq('status', 'cancelled'),
    ]);
    setStaffList((staffRes.data as (StaffOption & { position?: string })[]) ?? []);
    setMenuList((menuRes.data as MenuOption[]) ?? []);
    setBookings((bookingRes.data as BoardBooking[]) ?? []);
    setPriorKeys(new Set((priorRes.data as { email: string | null; customer_name: string }[] ?? []).map(custKey)));
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    setUpdatedAt(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
    setLoading(false);
  }, [facilityId, date]);

  useEffect(() => { loadData().catch(() => setLoading(false)); }, [loadData]);
  useEffect(() => { if (tab === 'suspend') fetchAcceptStatus().catch(() => {}); }, [tab, fetchAcceptStatus]);

  useEffect(() => {
    const update = () => {
      const now = new Date(Date.now() + 9 * 3600 * 1000);
      setNowMinutes(now.getUTCHours() * 60 + now.getUTCMinutes());
    };
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);

  // お客様管理：全予約から顧客一覧を集計（来店回数・最終来店）。DB追加不要。
  useEffect(() => {
    if (section !== 'customers') return;
    let cancelled = false;
    (async () => {
      setCustLoading(true);
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.from('bookings')
        .select('customer_name, email, phone, booking_date')
        .eq('facility_id', facilityId).neq('status', 'cancelled')
        .order('booking_date', { ascending: false });
      const map = new Map<string, { key: string; name: string; email: string | null; phone: string | null; count: number; last: string }>();
      for (const b of (data as { customer_name: string; email: string | null; phone: string | null; booking_date: string }[] ?? [])) {
        const key = (b.email || b.customer_name || '').toLowerCase();
        const ex = map.get(key);
        if (ex) { ex.count++; if (b.booking_date > ex.last) ex.last = b.booking_date; }
        else map.set(key, { key, name: b.customer_name, email: b.email, phone: b.phone, count: 1, last: b.booking_date });
      }
      if (!cancelled) { setCustomers(Array.from(map.values()).sort((a, b) => b.last.localeCompare(a.last))); setCustLoading(false); }
    })().catch(() => { if (!cancelled) setCustLoading(false); });
    return () => { cancelled = true; };
  }, [section, facilityId]);

  // 掲載管理：施設の掲載状況（基本情報・スタッフ数・写真数・メニュー数）を集計。DB追加不要。
  useEffect(() => {
    if (section !== 'listing' && section !== 'settings') return;
    let cancelled = false;
    (async () => {
      setListingLoading(true);
      const supabase = createBrowserSupabaseClient();
      const [fac, st, ph, mn] = await Promise.all([
        supabase.from('facility_profiles').select('name, status').eq('id', facilityId).maybeSingle(),
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('is_active', true),
        supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
        supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
      ]);
      if (!cancelled) {
        const f = fac.data as { name: string; status: string } | null;
        setListing({ name: f?.name ?? '—', status: f?.status ?? 'draft', staff: st.count ?? 0, photos: ph.count ?? 0, menus: mn.count ?? 0 });
        setListingLoading(false);
      }
    })().catch(() => { if (!cancelled) setListingLoading(false); });
    return () => { cancelled = true; };
  }, [section, facilityId]);

  // 売上管理：当月の予約から件数・売上(total_price)を集計。DB追加不要。
  useEffect(() => {
    if (section !== 'sales') return;
    let cancelled = false;
    (async () => {
      setSalesLoading(true);
      const supabase = createBrowserSupabaseClient();
      const month = date.slice(0, 7); // YYYY-MM
      const today = getTodayString();
      const { data } = await supabase.from('bookings')
        .select('booking_date, total_price, status')
        .eq('facility_id', facilityId).gte('booking_date', `${month}-01`).lte('booking_date', `${month}-31`)
        .in('status', ['confirmed', 'completed']);
      const rows = (data as { booking_date: string; total_price: number | null }[] ?? []);
      const byDay: Record<string, { c: number; s: number }> = {};
      let mc = 0, ms = 0, tc = 0, ts = 0;
      for (const r of rows) {
        const price = r.total_price ?? 0;
        mc++; ms += price;
        byDay[r.booking_date] = byDay[r.booking_date] || { c: 0, s: 0 };
        byDay[r.booking_date].c++; byDay[r.booking_date].s += price;
        if (r.booking_date === today) { tc++; ts += price; }
      }
      if (!cancelled) { setSales({ monthCount: mc, monthSum: ms, todayCount: tc, todaySum: ts, byDay }); setSalesLoading(false); }
    })().catch(() => { if (!cancelled) setSalesLoading(false); });
    return () => { cancelled = true; };
  }, [section, facilityId, date]);

  // 全画面オーバーレイ表示中は背後 body/html のスクロール（無用なスクロールバー）を無効化
  useEffect(() => {
    const html = document.documentElement;
    const prevBody = document.body.style.overflow;
    const prevHtml = html.style.overflow;
    document.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevBody; html.style.overflow = prevHtml; };
  }, []);

  const menuName = (menuId: string | null) => menuList.find((m) => m.id === menuId)?.name ?? '';
  const staffName = (staffId: string | null) => staffList.find((s) => s.id === staffId)?.name ?? '';
  const handleSaved = (message: string) => { setModal(null); setToast({ type: 'success', message }); loadData().catch(() => {}); };
  const handleCellClick = (staffId: string | null, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const start = offsetToTime(e.clientX - rect.left, rect.width, SALON_OPEN_HOUR, SALON_CLOSE_HOUR);
    setModal({ mode: 'create', staffId, startTime: start });
  };

  const isToday = date === getTodayString();
  const nowPct = isToday && nowMinutes !== null ? nowLinePosition(nowMinutes) : null;
  const trackWidth = HOURS.length * 4 * QUARTER_W;

  const visibleStaff = staffFilter ? staffList.filter((s) => s.id === staffFilter) : staffList;
  const rows: Row[] = [
    { kind: 'header', label: 'スタッフ' },
    ...visibleStaff.map((s) => ({ kind: 'staff' as const, id: s.id, name: s.name, sub: (s as { position?: string }).position || '' })),
    { kind: 'free', name: 'フリー指名', sub: '' },
  ];

  // 15分グリッド（営業時間外は分単位でグレー網掛け）
  const GridLines = () => (
    <div className="absolute inset-0 flex pointer-events-none">
      {HOURS.flatMap((h) => [0, 1, 2, 3].map((q) => {
        const startMin = h * 60 + q * 15;
        const closed = startMin < SHOP_OPEN_MIN || startMin >= SHOP_CLOSE_MIN;
        const border = q === 0 ? 'border-gray-300' : q === 2 ? 'border-gray-200' : 'border-transparent';
        return <div key={`${h}-${q}`} className={`border-l ${border} ${closed ? 'bg-gray-200/70' : ''}`} style={{ width: QUARTER_W }} />;
      }))}
    </div>
  );

  const Tab = ({ label, active, href, onClick }: { label: string; active?: boolean; href?: string; onClick?: () => void }) => {
    const cls = `px-4 py-2 text-xs font-bold rounded-t-md ${active ? 'bg-white text-sky-700 border border-b-white border-sky-300 -mb-px' : 'bg-sky-100/60 text-sky-700/80 hover:bg-white/70'}`;
    return href ? <Link href={href} className={cls}>{label}</Link> : <button type="button" onClick={onClick} className={cls}>{label}</button>;
  };

  // 日付ピッカー用の1ヶ月カレンダー（HPB準拠：日=赤/土=青・今日強調・選択強調）
  const MonthCal = ({ ym }: { ym: string }) => {
    const [y, mo] = ym.split('-').map(Number);
    const startWd = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const cells: (number | null)[] = [...Array(startWd).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    const wd = ['日', '月', '火', '水', '木', '金', '土'];
    const today = getTodayString();
    return (
      <div className="w-56">
        <div className="text-center text-sm font-bold text-gray-700 mb-1">{y}年 {mo}月</div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {wd.map((w, i) => <div key={w} className={`text-center text-[10px] py-0.5 ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : 'text-gray-500'}`}>{w}</div>)}
          {cells.map((d, idx) => {
            if (d === null) return <div key={`b${idx}`} className="h-7" />;
            const ds = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const wcol = (startWd + d - 1) % 7;
            const isSel = ds === date, isToday = ds === today;
            return (
              <button key={ds} type="button" onClick={() => { setDate(ds); setShowPicker(false); }}
                className={`h-7 text-xs rounded ${isSel ? 'bg-sky-500 text-white font-bold' : isToday ? 'bg-sky-100 text-sky-700 font-bold' : wcol === 0 ? 'text-rose-500 hover:bg-gray-100' : wcol === 6 ? 'text-sky-600 hover:bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}>{d}</button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col text-[12px] text-gray-800">
      {/* ブランドバー */}
      <div className="shrink-0 h-12 bg-sky-600 text-white flex items-center px-4 gap-4">
        <span className="flex items-center gap-2 font-bold text-sm shrink-0">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-white text-sky-600 font-extrabold">S</span>
          サロンボード
        </span>
        <nav className="flex items-center gap-2 text-xs ml-4 overflow-x-auto">
          {NAV.map((m, i) => {
            const navSection = (['reservation', 'listing', 'customers', 'sales', null, 'settings'] as const)[i];
            const isActive = navSection != null && section === navSection;
            const onClickNav = navSection != null ? () => setSection(navSection) : () => setToast({ type: 'success', message: `「${m}」は準備中です` });
            return (
            <button key={m} type="button"
              onClick={onClickNav}
              className={`px-3 py-1.5 rounded whitespace-nowrap tracking-wide ${isActive ? 'bg-sky-700' : 'hover:bg-sky-500/60'}`}>{m}</button>
            );
          })}
        </nav>
        <div className="flex-1" />
        <span className="hidden lg:inline text-xs opacity-90 shrink-0">店舗管理</span>
        <Link href="/admin/help" className="text-xs opacity-90 hover:opacity-100 shrink-0">ヘルプ</Link>
        <Link href="/admin" className="text-xs underline hover:no-underline shrink-0">← 管理画面へ戻る</Link>
      </div>

      {/* ===== 予約管理セクション（スケジュール/予約一覧タブ） ===== */}
      {section === 'reservation' && (<>
      {/* タブ */}
      <div className="shrink-0 flex items-stretch gap-1 bg-sky-200/50 border-b border-sky-300 px-2 pt-1.5">
        <Tab label="スケジュール" active={tab === 'schedule'} onClick={() => setTab('schedule')} />
        <Tab label="予約一覧" active={tab === 'list'} onClick={() => setTab('list')} />
        <Tab label="毎月の受付設定" active={tab === 'accept'} onClick={() => setTab('accept')} />
        <Tab label="一括停止・再開" active={tab === 'suspend'} onClick={() => setTab('suspend')} />
      </div>

      {/* ツールバー */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-300 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center shrink-0 relative">
          <button type="button" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="前日" className="px-1.5 py-1.5 border border-gray-300 rounded-l bg-white hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button ref={dateBtnRef} type="button" onClick={openDatePicker} className="flex items-center gap-1.5 px-3 py-1.5 border-y border-gray-300 bg-white hover:bg-gray-50">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-sm font-bold text-gray-800">{formatDateLabel(date)}</span>
          </button>
          <button type="button" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="翌日" className="px-1.5 py-1.5 border border-gray-300 rounded-r bg-white hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          {/* 2ヶ月並びカレンダー日付ピッカー（HPB準拠） */}
          {showPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
              <div className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-xl p-3" style={{ top: pickerPos.top, left: pickerPos.left }}>
                <div className="flex items-center justify-between mb-2">
                  <button type="button" onClick={() => setPickerYM((ym) => shiftYM(ym, -1))} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">前の月</button>
                  <button type="button" onClick={() => setPickerYM((ym) => shiftYM(ym, 1))} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">次の月</button>
                </div>
                <div className="flex gap-4">
                  <MonthCal ym={pickerYM} />
                  <MonthCal ym={shiftYM(pickerYM, 1)} />
                </div>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={() => setDate(getTodayString())} className="px-2 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50 text-xs shrink-0">今日</button>
        <div className="flex rounded overflow-hidden border border-gray-300 shrink-0">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} type="button" disabled={v !== 'day'}
              onClick={() => { if (v === 'day') setView('day'); }}
              title={v !== 'day' ? '準備中（現在は日表示のみ）' : undefined}
              className={`px-2.5 py-1 text-xs ${v === 'day' ? (view === v ? 'bg-sky-500 text-white' : 'bg-white text-gray-600') : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}>
              {v === 'day' ? '日' : v === 'week' ? '週' : '月'}
            </button>
          ))}
        </div>
        {/* 担当者絞り込み */}
        <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="px-2 py-1 border border-gray-300 rounded bg-white text-xs shrink-0">
          <option value="">全スタッフ</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => setShowLegend((s) => !s)} className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 text-xs shrink-0">アイコン凡例</button>
        <button type="button" onClick={() => window.print()} className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 text-xs shrink-0">印刷</button>
        <button type="button" onClick={() => loadData()} className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 text-xs shrink-0">最新を表示</button>
        <span className="text-[11px] text-gray-400 shrink-0">最終更新 {updatedAt}</span>
      </div>

      {showLegend && (
        <div className="shrink-0 flex flex-wrap gap-3 px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-[11px]">
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm ${statusStyle(k).bar}`} />{v}</span>
          ))}
          <span className="flex items-center gap-1"><span className="px-0.5 rounded bg-rose-500 text-white text-[9px] font-bold">指</span>指名（ネット指名）</span>
          <span className="flex items-center gap-1"><span className="px-0.5 rounded bg-gray-500 text-white text-[9px] font-bold">新</span>新規（初回来店）</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-gray-200/70 border border-gray-300" />営業時間外</span>
        </div>
      )}

      {/* グリッド（スケジュールタブ。内容高で終わり、下は白地。果てしない罫線を出さない） */}
      {tab === 'schedule' && (
      <div className="flex-1 overflow-auto bg-white">
        {loading ? (
          <div className="animate-pulse p-3"><div className="h-72 bg-gray-200 rounded" /></div>
        ) : (
          <div style={{ minWidth: LABEL_W + trackWidth }}>
            {/* 時間ヘッダー */}
            <div className="flex sticky top-0 z-30 bg-gray-100 border-b border-gray-300">
              <div className="shrink-0 sticky left-0 z-40 flex items-center justify-center font-bold text-gray-600 border-r border-gray-300 bg-gray-100" style={{ width: LABEL_W }}>スタッフ</div>
              <div className="flex">
                {HOURS.map((h) => (
                  <div key={h} className={`border-r border-gray-300 text-center text-[11px] py-0.5 ${h * 60 < SHOP_OPEN_MIN || h * 60 >= SHOP_CLOSE_MIN ? 'text-gray-300 bg-gray-200/40' : 'text-gray-500'}`} style={{ width: QUARTER_W * 4 }}>{h}:00</div>
                ))}
              </div>
            </div>

            {rows.map((row, idx) => {
              if (row.kind === 'header') {
                return (
                  <div key={`h-${idx}`} className="flex bg-sky-50 border-b border-sky-200">
                    <div className="px-2 py-0.5 text-[11px] font-bold text-sky-700 sticky left-0">{row.label}</div>
                  </div>
                );
              }
              const targetStaffId = row.kind === 'staff' ? row.id : null;
              const rowBookings = row.kind === 'staff'
                ? bookings.filter((b) => b.staff_id === row.id)
                : bookings.filter((b) => !b.staff_id);
              const laid = layoutRow(rowBookings);
              const rowKey = row.kind === 'staff' ? row.id : '__free__';
              return (
                <div key={rowKey} className="flex border-b border-gray-200 relative" style={{ height: ROW_H }}>
                  <div className="shrink-0 sticky left-0 z-20 border-r border-gray-300 bg-gray-50 px-2 flex flex-col justify-center" style={{ width: LABEL_W }}>
                    <span className="font-bold text-gray-800 truncate text-[13px] leading-tight">{row.name}</span>
                    {('sub' in row && row.sub) && <span className="text-[10px] text-gray-400 leading-tight truncate">{row.sub}</span>}
                  </div>
                  <div className="relative cursor-pointer" style={{ width: trackWidth }} onClick={(e) => handleCellClick(targetStaffId, e)}>
                    <GridLines />
                    {nowPct !== null && (
                      <div className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none" style={{ left: `${nowPct}%` }} />
                    )}
                    {laid.map(({ item, lane, laneCount }) => {
                      const { leftPct, widthPct } = blockPosition(item.start_time, item.end_time);
                      // 重なり予約は横並び（HPB方式）：時間幅をレーン数で等分し横にずらす
                      const laneW = widthPct / laneCount;
                      const blkLeft = leftPct + lane * laneW;
                      const ss = statusStyle(item.status);
                      // 指名＝ネット予約で顧客がスタッフを指定した予約 / 新規＝初回来店
                      const nominated = item.source === 'online' && !!item.staff_id;
                      const isNew = !priorKeys.has(custKey(item));
                      return (
                        <button type="button" key={item.id}
                          onClick={(e) => { e.stopPropagation(); setModal({ mode: 'edit', booking: item }); }}
                          className={`absolute rounded-sm border text-left overflow-hidden hover:brightness-95 z-10 flex ${ss.block}`}
                          style={{ left: `${blkLeft}%`, width: `calc(${laneW}% - 1px)`, top: '1px', bottom: '1px' }}
                          title={`${item.customer_name} 様 ${item.start_time.slice(0, 5)}〜${item.end_time.slice(0, 5)} ${menuName(item.menu_id)} ${staffName(item.staff_id)}`}>
                          <span className={`w-1 shrink-0 ${ss.bar}`} />
                          <span className="px-1 py-0.5 overflow-hidden leading-tight">
                            <span className="flex items-center gap-0.5">
                              {nominated && <span className="px-0.5 rounded bg-rose-500 text-white text-[8px] font-bold">指</span>}
                              {isNew && <span className="px-0.5 rounded bg-gray-500 text-white text-[8px] font-bold">新</span>}
                              <span className="font-bold truncate text-[10px]">{item.customer_name} 様</span>
                            </span>
                            <span className="block text-[9px] opacity-75 truncate">{item.start_time.slice(0, 5)}〜{item.end_time.slice(0, 5)}</span>
                            {menuName(item.menu_id) && <span className="block text-[9px] opacity-70 truncate">{menuName(item.menu_id)}</span>}
                            {item.staff_id && <span className="block text-[9px] opacity-60 truncate">◆{staffName(item.staff_id)}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {staffList.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-xs">
                スタッフが登録されていません。<Link href="/admin/staff" className="text-sky-600 underline">スタッフ管理</Link>から登録してください。
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* 予約一覧タブ（サロンボードの枠内に表示・別画面へ遷移しない） */}
      {tab === 'list' && (
        <div className="flex-1 overflow-auto bg-white">
          {/* ステータス絞り込み */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 sticky top-0 bg-white z-10">
            {[['all', '全て'], ['confirmed', '確定'], ['completed', '完了'], ['no_show', '無断ｷｬﾝｾﾙ']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setListFilter(v)}
                className={`px-3 py-1 text-xs rounded-full font-medium ${listFilter === v ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
            ))}
            <span className="ml-auto text-[11px] text-gray-400">{bookings.filter((b) => listFilter === 'all' || b.status === listFilter).length} 件</span>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-100 text-gray-600 sticky top-[41px]">
              <tr>
                {['時間', 'お客様', 'メニュー', '担当', '経路', 'ステータス'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 border-b border-gray-300 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...bookings].filter((b) => listFilter === 'all' || b.status === listFilter).sort((a, b) => a.start_time.localeCompare(b.start_time)).map((bk) => (
                <tr key={bk.id} className="hover:bg-sky-50 cursor-pointer border-b border-gray-100" onClick={() => setModal({ mode: 'edit', booking: bk })}>
                  <td className="px-3 py-2 whitespace-nowrap">{bk.start_time.slice(0, 5)}〜{bk.end_time.slice(0, 5)}</td>
                  <td className="px-3 py-2 font-bold whitespace-nowrap">{bk.customer_name} 様</td>
                  <td className="px-3 py-2">{menuName(bk.menu_id) || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{staffName(bk.staff_id) || 'フリー'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{bk.source === 'walk_in' ? '店頭' : bk.source === 'phone' ? '電話' : 'ネット'}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-white text-[10px] font-bold ${statusStyle(bk.status).bar}`}>{STATUS_LABEL[bk.status] || bk.status}</span></td>
                </tr>
              ))}
              {bookings.filter((b) => listFilter === 'all' || b.status === listFilter).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">該当する予約はありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 毎月の受付設定タブ（HPB準拠：受付設定ハブ） */}
      {tab === 'accept' && (() => {
        const [y, mo] = date.split('-').map(Number);
        const months = Array.from({ length: 4 }, (_, i) => { const d = new Date(Date.UTC(y, mo - 1 + i, 1)); return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, '0')}月`; });
        const MonthTable = ({ rowLabel }: { rowLabel: string }) => (
          <div className="border border-gray-300 rounded overflow-hidden bg-white">
            <div className="grid grid-cols-5 text-[11px]">
              <div className="bg-amber-50 border-r border-b border-gray-200 px-2 py-2 font-bold text-gray-600 flex items-center">{rowLabel}</div>
              {months.map((m, i) => (
                <div key={m} className={`border-b border-gray-200 px-2 py-2 text-center ${i < 3 ? 'border-r' : ''}`}>
                  <div className="text-gray-500 mb-1">{m}</div>
                  <button type="button" onClick={() => setToast({ type: 'success', message: `${m}の詳細設定は準備中です` })} className="px-3 py-1 text-[11px] border border-sky-400 text-sky-600 rounded hover:bg-sky-50">設定</button>
                </div>
              ))}
            </div>
          </div>
        );
        return (
          <div className="flex-1 overflow-auto bg-gray-50 p-4">
            <div className="max-w-3xl space-y-5">
              <p className="text-xs text-gray-600 leading-relaxed">サロンの営業時間枠・受付枠数を日別に設定します。シフトも日別に設定できます。設定が完了すると、スケジュール画面で予約を登録・管理できるようになり、ネット予約の受付が開始されます。</p>
              <div>
                <h3 className="text-sm font-bold text-gray-800 mb-1">■ サロンの受付設定 <span className="text-[11px] text-emerald-600">【自動延長中】</span></h3>
                <p className="text-[11px] text-gray-500 mb-2">1ヶ月単位で、サロン全体の受付可能枠を日別に設定します。予約が受付枠数に達した日はネット予約の受付が自動停止します。</p>
                <MonthTable rowLabel="サロンの営業時間帯・受付可能枠数（日別）" />
                <button type="button" onClick={() => setToast({ type: 'success', message: '時間別設定は準備中です' })} className="mt-2 px-3 py-1.5 text-xs font-bold bg-sky-100 text-sky-700 rounded hover:bg-sky-200">サロンの受付可能枠数を時間別に設定する場合はこちら</button>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800 mb-1">■ スタッフの受付設定 <span className="text-[11px] text-emerald-600">【自動延長中】</span></h3>
                <p className="text-[11px] text-gray-500 mb-2">スタッフの1ヶ月分のシフトを設定します。休暇や枠を設定すると、ネット予約の受付が停止できます。</p>
                <MonthTable rowLabel="勤務パターン設定・シフト設定" />
              </div>
            </div>
          </div>
        );
      })()}

      {/* 一括停止・再開タブ（HPB準拠：日時指定フォーム） */}
      {tab === 'suspend' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          <div className="max-w-3xl space-y-5">
            <h2 className="text-base font-bold text-gray-800">ネット予約の一括停止・再開設定</h2>
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">■ 日時を指定してネット予約受付を一括で停止・再開します。</h3>
              <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="bg-amber-50 px-3 py-1.5 rounded text-gray-600 text-xs font-bold">年月日</span>
                  <span className="font-bold text-gray-800">{formatDateLabel(date)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="bg-amber-50 px-3 py-1.5 rounded text-gray-600 text-xs font-bold">時間</span>
                  <select className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{Array.from({ length: 14 }, (_, i) => i + 9).map((h) => <option key={h}>{h}</option>)}</select><span>時</span>
                  <select className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{['00', '30'].map((m) => <option key={m}>{m}</option>)}</select><span>分</span>
                  <span className="px-1">から</span>
                  <select className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{Array.from({ length: 14 }, (_, i) => i + 9).map((h) => <option key={h}>{h}</option>)}</select><span>時</span>
                  <select className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{['00', '30'].map((m) => <option key={m}>{m}</option>)}</select><span>分</span>
                  <span className="px-1">まで</span>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs text-gray-500">上記日時のネット予約受付を一括で</span>
                  <button type="button" disabled={acceptBusy || acceptStatus === 'suspended'} onClick={() => toggleAccept('suspend')}
                    className="px-6 py-2 rounded text-sm font-bold border border-gray-400 text-gray-700 hover:bg-gray-50 disabled:opacity-40 bg-white">{acceptBusy ? '処理中…' : '停止する'}</button>
                  <button type="button" disabled={acceptBusy || acceptStatus === 'published'} onClick={() => toggleAccept('resume')}
                    className="px-6 py-2 rounded text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-40">{acceptBusy ? '処理中…' : '再開する'}</button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">※一括停止できるのは、前日から数日後までです。それ以降の調整は「毎月の受付設定」から行ってください。<br />※時間帯ごとの細かな指定は今後対応予定で、現在は受付全体の停止/再開を切り替えます。</p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">■ 一括停止中の時間帯一覧</h3>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                {acceptStatus === 'suspended'
                  ? <span className="text-rose-600 font-bold">現在、ネット予約の受付を停止中です。</span>
                  : <span className="text-gray-400">現在、ネット予約受付を一括停止中の時間帯はありません。</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* フッター：日付ナビ＋アクション（右下のチャットウィジェットと被らないよう右余白を確保） */}
      {(tab === 'schedule' || tab === 'list') && (
      <div className="shrink-0 flex items-center gap-2 pl-3 pr-24 py-1.5 bg-gray-100 border-t border-gray-300 overflow-x-auto whitespace-nowrap">
        <button type="button" onClick={() => setDate((d) => shiftDate(d, -1))} className="px-2 py-1 text-[11px] bg-white border border-gray-300 rounded hover:bg-gray-50 shrink-0">前の日</button>
        <span className="px-1 text-[11px] font-bold text-gray-600 shrink-0">{formatDateLabel(date)}</span>
        <button type="button" onClick={() => setDate((d) => shiftDate(d, 1))} className="px-2 py-1 text-[11px] bg-white border border-gray-300 rounded hover:bg-gray-50 shrink-0">次の日</button>
        <span className="px-2 text-[11px] text-gray-500 shrink-0">全 {bookings.length} 件</span>
        <div className="flex-1" />
        <button type="button" onClick={() => setToast({ type: 'success', message: 'シフト設定は準備中です' })}
          className="px-4 py-1.5 text-xs font-bold border border-sky-500 text-sky-600 rounded hover:bg-sky-50 bg-white shrink-0">シフト設定</button>
        <button type="button" onClick={() => setModal({ mode: 'create', staffId: visibleStaff[0]?.id ?? null, startTime: `${String(SHOP_OPEN_MIN / 60).padStart(2, '0')}:00` })}
          className="px-4 py-1.5 text-xs font-bold text-white bg-sky-500 rounded hover:bg-sky-600 shrink-0">予約登録</button>
      </div>
      )}
      </>)}

      {/* ===== お客様管理セクション（顧客一覧・既存予約から集計） ===== */}
      {section === 'customers' && (
        <div className="flex-1 overflow-auto bg-white">
          <div className="px-4 py-2.5 border-b border-gray-300 bg-gray-50 sticky top-0 z-10 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-gray-800">お客様一覧</span>
              <span className="text-[11px] text-gray-400">全 {customers.length} 名</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input type="text" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="氏名・電話・メール" className="px-3 py-1.5 border border-gray-300 rounded w-56" />
              <label className="text-gray-500">来店回数</label>
              <input type="number" min={0} value={custSearchVisit} onChange={(e) => setCustSearchVisit(e.target.value)} placeholder="以上" className="px-2 py-1.5 border border-gray-300 rounded w-20" />
              <label className="text-gray-500">最終来店</label>
              <input type="date" value={custSearchSince} onChange={(e) => setCustSearchSince(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded" />
              <span className="text-gray-500">以降</span>
              <button type="button" onClick={() => { setCustSearch(''); setCustSearchVisit(''); setCustSearchSince(''); }} className="px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50">条件をクリア</button>
            </div>
          </div>
          {custLoading ? (
            <div className="animate-pulse p-3"><div className="h-64 bg-gray-200 rounded" /></div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-100 text-gray-600 sticky top-[88px]">
                <tr>{['お客様名', '電話', 'メール', '来店回数', '最終来店'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 border-b border-gray-300 font-bold whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {customers.filter((c) => {
                  const q = custSearch.trim().toLowerCase();
                  if (q && !(c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q))) return false;
                  if (custSearchVisit && c.count < Number(custSearchVisit)) return false;
                  if (custSearchSince && c.last < custSearchSince) return false;
                  return true;
                }).map((c) => (
                  <tr key={c.key} className="border-b border-gray-100 hover:bg-sky-50 cursor-pointer" onClick={() => openCustomerHistory(c)}>
                    <td className="px-3 py-2 font-bold whitespace-nowrap">{c.name} 様</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.phone || '—'}</td>
                    <td className="px-3 py-2">{c.email || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.count} 回</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.last}</td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">お客様データがありません</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== 掲載管理セクション（掲載状況・既存データから集計） ===== */}
      {section === 'listing' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          {listingLoading || !listing ? (
            <div className="animate-pulse"><div className="h-48 bg-gray-200 rounded max-w-2xl" /></div>
          ) : (
            <div className="max-w-2xl space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-400">掲載中のサロン</div>
                  <div className="text-base font-bold text-gray-800">{listing.name}</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${listing.status === 'published' ? 'bg-emerald-100 text-emerald-700' : listing.status === 'suspended' ? 'bg-rose-100 text-rose-700' : 'bg-gray-200 text-gray-600'}`}>
                  {listing.status === 'published' ? '公開中' : listing.status === 'suspended' ? '停止中' : '下書き'}
                </span>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-2 bg-gray-100 text-xs font-bold text-gray-600 border-b border-gray-200">掲載情報</div>
                {[
                  { label: 'サロン掲載情報（基本情報）', val: '登録済み', href: '/admin/settings' },
                  { label: 'スタッフ掲載情報', val: `${listing.staff} 名`, href: '/admin/staff' },
                  { label: 'フォトギャラリー掲載情報', val: `${listing.photos} 枚`, href: '/admin/photos' },
                  { label: 'メニュー掲載情報', val: `${listing.menus} 件`, href: '/admin/menus' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-gray-700">{row.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-800">{row.val}</span>
                      <Link href={row.href} className="text-xs px-3 py-1 border border-sky-400 text-sky-600 rounded hover:bg-sky-50">編集</Link>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">各項目の編集は対応する管理ページで行います。掲載のオン/オフは「設定」から変更できます。</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 売上管理セクション（予約データから集計） ===== */}
      {section === 'sales' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          {salesLoading || !sales ? (
            <div className="animate-pulse"><div className="h-40 bg-gray-200 rounded max-w-3xl" /></div>
          ) : (
            <div className="max-w-3xl space-y-4">
              <div className="text-sm font-bold text-gray-800">売上管理（{date.slice(0, 7).replace('-', '年')}月）</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { l: '当月 予約件数', v: `${sales.monthCount} 件` },
                  { l: '当月 売上合計', v: `¥${sales.monthSum.toLocaleString()}` },
                  { l: '本日 予約件数', v: `${sales.todayCount} 件` },
                  { l: '本日 売上合計', v: `¥${sales.todaySum.toLocaleString()}` },
                ].map((c) => (
                  <div key={c.l} className="bg-white rounded-lg border border-gray-200 p-3">
                    <div className="text-[11px] text-gray-400">{c.l}</div>
                    <div className="text-lg font-bold text-gray-800 mt-1">{c.v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-2 bg-gray-100 text-xs font-bold text-gray-600 border-b border-gray-200">日別 売上（確定・完了のみ）</div>
                <table className="w-full text-xs">
                  <thead className="text-gray-500"><tr><th className="text-left px-4 py-2">日付</th><th className="text-right px-4 py-2">件数</th><th className="text-right px-4 py-2">売上</th></tr></thead>
                  <tbody>
                    {Object.keys(sales.byDay).sort().map((d) => (
                      <tr key={d} className="border-t border-gray-100"><td className="px-4 py-2">{d}</td><td className="px-4 py-2 text-right">{sales.byDay[d].c}</td><td className="px-4 py-2 text-right">¥{sales.byDay[d].s.toLocaleString()}</td></tr>
                    ))}
                    {sales.monthCount === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">当月の売上データがありません</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400">売上は予約のメニュー料金（total_price）の合計です。詳細な会計連携は「会計連携」をご利用ください。</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 設定セクション ===== */}
      {section === 'settings' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          <div className="max-w-2xl space-y-4">
            <div className="text-sm font-bold text-gray-800">設定</div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-400">サロン名</div>
              <div className="text-base font-bold text-gray-800">{listing?.name ?? '—'}</div>
              <div className="text-xs text-gray-400 mt-2">掲載ステータス</div>
              <div className="text-sm font-medium text-gray-800">{listing?.status === 'published' ? '公開中' : listing?.status === 'suspended' ? '停止中' : '下書き'}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 bg-gray-100 text-xs font-bold text-gray-600 border-b border-gray-200">各種設定</div>
              {[
                { l: '店舗・基本情報', href: '/admin/settings' },
                { l: 'スタッフ管理', href: '/admin/staff' },
                { l: 'メニュー管理', href: '/admin/menus' },
                { l: 'クーポン', href: '/admin/coupons' },
                { l: '写真管理', href: '/admin/photos' },
                { l: '決済設定', href: '/admin/payments' },
              ].map((row) => (
                <Link key={row.l} href={row.href} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-sky-50">
                  <span className="text-sm text-gray-700">{row.l}</span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 最下部フッターリンク（控えめ・HPB準拠の淡色） */}
      <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-0.5 bg-gray-50 border-t border-gray-200 text-gray-400 text-[10px]">
        <Link href="/legal/terms" className="hover:text-gray-600">利用規約</Link>
        <Link href="/legal/privacy" className="hover:text-gray-600">プライバシーポリシー</Link>
        <Link href="/admin/help" className="hover:text-gray-600">ヘルプ</Link>
        <span>© CareLink</span>
      </div>

      {/* お客様カルテ（属性＋来店履歴） */}
      {custDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCustDetail(null)}>
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="text-base font-bold">{custDetail.name} 様 のカルテ</h2>
              <button type="button" onClick={() => setCustDetail(null)} aria-label="閉じる" className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 顧客属性カード */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['電話', custDetail.phone || '—'],
                  ['メール', custDetail.email || '—'],
                  ['来店回数', `${custDetail.rows.length} 回`],
                  ['累計売上', `¥${custDetail.totalSum.toLocaleString()}`],
                  ['誕生日', custDetail.profile?.birth_date || '—'],
                  ['性別', custDetail.profile?.gender === 'male' ? '男性' : custDetail.profile?.gender === 'female' ? '女性' : custDetail.profile?.gender ? 'その他' : '—'],
                  ['エリア', [custDetail.profile?.prefecture, custDetail.profile?.city].filter(Boolean).join(' ') || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="bg-gray-50 rounded p-2"><div className="text-gray-400 text-[10px]">{k}</div><div className="font-medium text-gray-800">{v}</div></div>
                ))}
              </div>
              {/* 来店履歴 */}
              <div>
                <div className="text-xs font-bold text-gray-600 mb-1">来店履歴</div>
                <table className="w-full text-xs">
                  <thead className="text-gray-500"><tr><th className="text-left py-1">日付</th><th className="text-left py-1">時間</th><th className="text-left py-1">メニュー</th><th className="text-left py-1">担当</th><th className="text-right py-1">金額</th><th className="text-left py-1 pl-2">状態</th></tr></thead>
                  <tbody>
                    {custDetail.rows.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="py-1.5">{r.booking_date}</td>
                        <td className="py-1.5">{r.start_time.slice(0, 5)}</td>
                        <td className="py-1.5">{menuName(r.menu_id) || '—'}</td>
                        <td className="py-1.5">{staffName(r.staff_id) || 'フリー'}</td>
                        <td className="py-1.5 text-right">{r.total_price != null ? `¥${r.total_price.toLocaleString()}` : '—'}</td>
                        <td className="py-1.5 pl-2">{STATUS_LABEL[r.status] || r.status}</td>
                      </tr>
                    ))}
                    {custDetail.loading && <tr><td colSpan={6} className="py-6 text-center text-gray-400">読み込み中…</td></tr>}
                    {!custDetail.loading && custDetail.rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-400">来店履歴がありません</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <BookingModal init={modal} facilityId={facilityId} date={date} staffList={staffList} menuList={menuList}
          onClose={() => setModal(null)} onSaved={handleSaved} onError={(message) => setToast({ type: 'error', message })} />
      )}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
