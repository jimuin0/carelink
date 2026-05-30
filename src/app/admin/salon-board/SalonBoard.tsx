'use client';

import { useState, useEffect, useCallback } from 'react';
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
  availableSlotCount,
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
  const [tab, setTab] = useState<'schedule' | 'list'>('schedule');
  const [priorKeys, setPriorKeys] = useState<Set<string>>(new Set());
  const [section, setSection] = useState<'reservation' | 'customers' | 'listing'>('reservation');
  const [customers, setCustomers] = useState<{ key: string; name: string; email: string | null; phone: string | null; count: number; last: string }[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [listing, setListing] = useState<{ name: string; status: string; staff: number; photos: number; menus: number } | null>(null);
  const [listingLoading, setListingLoading] = useState(false);

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
    if (section !== 'listing') return;
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
            const isActive = (i === 0 && section === 'reservation') || (i === 1 && section === 'listing') || (i === 2 && section === 'customers');
            const onClickNav = i === 0 ? () => setSection('reservation') : i === 1 ? () => setSection('listing') : i === 2 ? () => setSection('customers') : () => setToast({ type: 'success', message: `「${m}」は準備中です` });
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
        <Tab label="毎月の受付設定" onClick={() => setToast({ type: 'success', message: '受付設定は準備中です' })} />
        <Tab label="一括停止・再開" onClick={() => setToast({ type: 'success', message: '一括停止・再開は準備中です' })} />
      </div>

      {/* ツールバー */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-300 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center shrink-0">
          <button type="button" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="前日" className="px-1.5 py-1 border border-gray-300 rounded-l bg-white hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <input type="date" lang="ja" value={date} onChange={(e) => setDate(e.target.value)} className="px-1.5 py-1 border-y border-gray-300 bg-white text-xs" />
          <button type="button" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="翌日" className="px-1.5 py-1 border border-gray-300 rounded-r bg-white hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <button type="button" onClick={() => setDate(getTodayString())} className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 text-xs shrink-0">今日</button>
        <span className="text-sm font-bold text-gray-800 shrink-0">{formatDateLabel(date)}</span>
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
              const free = availableSlotCount(rowBookings);
              const rowKey = row.kind === 'staff' ? row.id : '__free__';
              return (
                <div key={rowKey} className="flex border-b border-gray-200 relative" style={{ height: ROW_H }}>
                  <div className="shrink-0 sticky left-0 z-20 border-r border-gray-300 bg-gray-50 px-2 flex flex-col justify-center" style={{ width: LABEL_W }}>
                    <span className="font-bold text-gray-800 truncate text-[12px] leading-tight">{row.name}{('sub' in row && row.sub) ? `（${row.sub}）` : ''}</span>
                    <span className="text-[10px] text-gray-400 leading-tight truncate">受付可能数：{free}</span>
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
        <div className="flex-1 overflow-auto bg-white p-3">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-100 text-gray-600 sticky top-0">
              <tr>
                {['時間', 'お客様', 'メニュー', '担当', '経路', 'ステータス'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 border-b border-gray-300 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...bookings].sort((a, b) => a.start_time.localeCompare(b.start_time)).map((bk) => (
                <tr key={bk.id} className="hover:bg-sky-50 cursor-pointer border-b border-gray-100" onClick={() => setModal({ mode: 'edit', booking: bk })}>
                  <td className="px-3 py-2 whitespace-nowrap">{bk.start_time.slice(0, 5)}〜{bk.end_time.slice(0, 5)}</td>
                  <td className="px-3 py-2 font-bold whitespace-nowrap">{bk.customer_name} 様</td>
                  <td className="px-3 py-2">{menuName(bk.menu_id) || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{staffName(bk.staff_id) || 'フリー'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{bk.source === 'walk_in' ? '店頭' : bk.source === 'phone' ? '電話' : 'ネット'}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-white text-[10px] font-bold ${statusStyle(bk.status).bar}`}>{STATUS_LABEL[bk.status] || bk.status}</span></td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">この日の予約はありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* フッター：日付ナビ＋アクション（右下のチャットウィジェットと被らないよう右余白を確保） */}
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
      </>)}

      {/* ===== お客様管理セクション（顧客一覧・既存予約から集計） ===== */}
      {section === 'customers' && (
        <div className="flex-1 overflow-auto bg-white">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-300 bg-white sticky top-0 z-10">
            <span className="text-sm font-bold text-gray-800">お客様一覧</span>
            <input type="text" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="氏名・電話・メールで検索"
              className="px-3 py-1.5 border border-gray-300 rounded text-xs w-64" />
            <span className="text-[11px] text-gray-400">全 {customers.length} 名</span>
          </div>
          {custLoading ? (
            <div className="animate-pulse p-3"><div className="h-64 bg-gray-200 rounded" /></div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-100 text-gray-600 sticky top-[45px]">
                <tr>{['お客様名', '電話', 'メール', '来店回数', '最終来店'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 border-b border-gray-300 font-bold whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {customers.filter((c) => {
                  const q = custSearch.trim().toLowerCase();
                  return !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q);
                }).map((c) => (
                  <tr key={c.key} className="border-b border-gray-100 hover:bg-sky-50">
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

      {/* 最下部フッターリンク（控えめ・HPB準拠の淡色） */}
      <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-0.5 bg-gray-50 border-t border-gray-200 text-gray-400 text-[10px]">
        <Link href="/legal/terms" className="hover:text-gray-600">利用規約</Link>
        <Link href="/legal/privacy" className="hover:text-gray-600">プライバシーポリシー</Link>
        <Link href="/admin/help" className="hover:text-gray-600">ヘルプ</Link>
        <span>© CareLink</span>
      </div>

      {modal && (
        <BookingModal init={modal} facilityId={facilityId} date={date} staffList={staffList} menuList={menuList}
          onClose={() => setModal(null)} onSaved={handleSaved} onError={(message) => setToast({ type: 'error', message })} />
      )}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
