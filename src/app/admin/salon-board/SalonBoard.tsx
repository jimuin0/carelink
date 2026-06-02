'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ListingBoard from './ListingBoard';
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
const NAV =['予約管理', '掲載管理', 'お客様管理', 'メッセージ管理', '売上管理', '集計・分析', 'サロンダイレクト', '振込・請求', '設定'];
const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];

// 週ビュー: 表示中日付を含む週（日曜起点・7日）の "YYYY-MM-DD"[] を UTC 基準で返す
function weekDatesOf(dateStr: string): string[] {
  const wd = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const start = shiftDate(dateStr, -wd);
  return Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
}
// 月ビュー: 当月カレンダー用に前後余白 null を含む 7×N グリッド配列を返す
function monthGridOf(dateStr: string): (string | null)[] {
  const ym = dateStr.slice(0, 7);
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10);
  const startWd = new Date(`${ym}-01T00:00:00Z`).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

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
  // 履歴取得が失敗した場合は null（判定不能）にして「新規」バッジを誤表示しない
  const [priorKeys, setPriorKeys] = useState<Set<string> | null>(new Set());
  const [listingReloadKey, setListingReloadKey] = useState(0); // 掲載ステータス再取得トリガ
  const [section, setSection] = useState<'reservation' | 'customers' | 'listing' | 'sales' | 'billing' | 'settings'>('reservation');
  const [sales, setSales] = useState<{ monthCount: number; monthSum: number; todayCount: number; todaySum: number; byDay: Record<string, { c: number; s: number }> } | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [customers, setCustomers] = useState<{ key: string; name: string; email: string | null; phone: string | null; count: number; last: string }[]>([]);
  const [custLoading, setCustLoading] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [custSearchVisit, setCustSearchVisit] = useState('');
  const [custSearchSince, setCustSearchSince] = useState('');
  const [custDetail, setCustDetail] = useState<{
    name: string; email: string | null; phone: string | null; loading: boolean; error?: boolean;
    totalSum: number; profile: { birth_date: string | null; gender: string | null; prefecture: string | null; city: string | null } | null;
    rows: { id: string; booking_date: string; start_time: string; end_time: string; menu_id: string | null; staff_id: string | null; status: string; total_price: number | null }[];
  } | null>(null);
  // お客様カルテ メモ/タグ/次回案内(#42-#45)の編集状態（custDetail とは別管理）
  const [karteKey, setKarteKey] = useState('');
  const [karteEdit, setKarteEdit] = useState<{ note: string; tags: string; nextDate: string; nextNote: string }>({ note: '', tags: '', nextDate: '', nextNote: '' });
  const [karteSaving, setKarteSaving] = useState(false);

  const saveKarte = async () => {
    if (karteSaving || !karteKey) return; setKarteSaving(true);
    try {
      const tags = karteEdit.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
      const res = await fetch(`/api/admin/customer-note?facility_id=${facilityId}&customer_key=${encodeURIComponent(karteKey)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: karteEdit.note.trim() || null, tags, next_visit_date: karteEdit.nextDate || null, next_visit_note: karteEdit.nextNote.trim() || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setToast({ type: 'error', message: d.error || 'カルテの保存に失敗しました' }); setKarteSaving(false); return; }
      setToast({ type: 'success', message: 'カルテを保存しました' });
    } catch { setToast({ type: 'error', message: '通信エラーが発生しました' }); } finally { setKarteSaving(false); }
  };

  const openCustomerHistory = async (c: { key: string; name: string; email: string | null; phone: string | null }) => {
    setCustDetail({ name: c.name, email: c.email, phone: c.phone, loading: true, totalSum: 0, profile: null, rows: [] });
    setKarteKey(c.key);
    setKarteEdit({ note: '', tags: '', nextDate: '', nextNote: '' });
    // カルテ（メモ/タグ/次回案内）を取得
    try {
      const nr = await fetch(`/api/admin/customer-note?facility_id=${facilityId}&customer_key=${encodeURIComponent(c.key)}`);
      if (nr.ok) {
        const nd = await nr.json().catch(() => null);
        const n = nd?.note;
        if (n) setKarteEdit({ note: n.note ?? '', tags: Array.isArray(n.tags) ? n.tags.join(', ') : '', nextDate: n.next_visit_date ?? '', nextNote: n.next_visit_note ?? '' });
      }
    } catch { /* カルテ取得失敗は致命的でない（来店履歴は表示する） */ }
    const supabase = createBrowserSupabaseClient();
    let q = supabase.from('bookings').select('id, booking_date, start_time, end_time, menu_id, staff_id, status, total_price').eq('facility_id', facilityId).neq('status', 'cancelled').order('booking_date', { ascending: false });
    q = c.email ? q.eq('email', c.email) : q.eq('customer_name', c.name);
    const bk = await q;
    // 取得失敗を「来店0回・¥0」と誤表示しない
    if (bk.error) { setCustDetail({ name: c.name, email: c.email, phone: c.phone, loading: false, error: true, totalSum: 0, profile: null, rows: [] }); return; }
    const rows = (bk.data as { id: string; booking_date: string; start_time: string; end_time: string; menu_id: string | null; staff_id: string | null; status: string; total_price: number | null }[]) ?? [];
    const totalSum = rows.filter((r) => r.status === 'confirmed' || r.status === 'completed').reduce((s, r) => s + (r.total_price ?? 0), 0);
    // 顧客属性(profiles)はブラウザ+RLS では他ユーザー分を読めないため、service-role 経由の専用APIで取得
    let profile: { birth_date: string | null; gender: string | null; prefecture: string | null; city: string | null } | null = null;
    if (c.email) {
      try {
        const r = await fetch(`/api/admin/customer-profile?facility_id=${facilityId}&email=${encodeURIComponent(c.email)}`);
        if (r.ok) { const d = await r.json().catch(() => null); profile = d?.profile ?? null; }
      } catch { /* 属性取得失敗は致命的でないため握りつぶし、来店履歴は表示する */ }
    }
    setCustDetail({ name: c.name, email: c.email, phone: c.phone, loading: false, totalSum, profile, rows });
  };
  const [listing, setListing] = useState<{ name: string; status: string; staff: number; photos: number; menus: number } | null>(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [acceptStatus, setAcceptStatus] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  // 時間帯指定の一括停止(#03/#09/#10)
  const [suspensions, setSuspensions] = useState<{ id: string; suspend_date: string; start_time: string; end_time: string }[]>([]);
  const [susForm, setSusForm] = useState({ sh: '10', sm: '00', eh: '19', em: '00' });
  const [susBusy, setSusBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYM, setPickerYM] = useState(() => getTodayString().slice(0, 7)); // 左側に表示する月 YYYY-MM
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  const fetchAcceptStatus = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase.from('facility_profiles').select('status').eq('id', facilityId).maybeSingle();
    setAcceptStatus((data as { status: string } | null)?.status ?? 'draft');
  }, [facilityId]);

  // 時間帯停止枠の取得/作成/削除(#03/#09/#10)
  const loadSuspensions = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/booking-suspension?facility_id=${facilityId}`);
      if (res.ok) { const d = await res.json().catch(() => null); setSuspensions(d?.suspensions ?? []); }
    } catch { /* noop（停止枠の取得失敗は致命的でない） */ }
  }, [facilityId]);
  const createSuspension = async () => {
    if (susBusy) return;
    const start_time = `${susForm.sh}:${susForm.sm}`;
    const end_time = `${susForm.eh}:${susForm.em}`;
    if (start_time >= end_time) { setToast({ type: 'error', message: '開始時刻は終了時刻より前にしてください' }); return; }
    setSusBusy(true);
    try {
      const res = await fetch(`/api/admin/booking-suspension?facility_id=${facilityId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suspend_date: date, start_time, end_time }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setToast({ type: 'error', message: d.error || '停止の登録に失敗しました' }); setSusBusy(false); return; }
      setToast({ type: 'success', message: '指定時間帯のネット予約受付を停止しました' });
      await loadSuspensions();
    } catch { setToast({ type: 'error', message: '通信エラーが発生しました' }); } finally { setSusBusy(false); }
  };
  const deleteSuspension = async (id: string) => {
    if (susBusy) return; setSusBusy(true);
    try {
      const res = await fetch(`/api/admin/booking-suspension?facility_id=${facilityId}&id=${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setToast({ type: 'error', message: d.error || '解除に失敗しました' }); setSusBusy(false); return; }
      setToast({ type: 'success', message: '停止を解除しました（受付を再開）' });
      await loadSuspensions();
    } catch { setToast({ type: 'error', message: '通信エラーが発生しました' }); } finally { setSusBusy(false); }
  };

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

  // 前/次ボタンの移動量をビューに合わせる（日=±1日 / 週=±7日 / 月=±1ヶ月）
  const stepDate = (dir: -1 | 1) => setDate((d) => {
    if (view === 'week') return shiftDate(d, dir * 7);
    if (view === 'month') {
      const ym = shiftYM(d.slice(0, 7), dir);
      const last = new Date(Date.UTC(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10), 0)).getUTCDate();
      const day = Math.min(parseInt(d.slice(8), 10), last);
      return `${ym}-${String(day).padStart(2, '0')}`;
    }
    return shiftDate(d, dir);
  });

  // 新規（初回来店）判定キー
  const custKey = (b: { email: string | null; customer_name: string }) =>
    (b.email || b.customer_name || '').toLowerCase();

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const [staffRes, menuRes, bookingRes, priorRes] = await Promise.all([
      supabase.from('staff_profiles').select('id, name, position').eq('facility_id', facilityId).eq('is_active', true).order('sort_order').order('created_at', { ascending: true }),
      supabase.from('facility_menus').select('id, name, duration_minutes, price').eq('facility_id', facilityId).order('sort_order').order('created_at', { ascending: true }),
      supabase.from('bookings')
        .select('id, staff_id, menu_id, customer_name, email, phone, note, start_time, end_time, status, source, total_price')
        .eq('facility_id', facilityId).eq('booking_date', date).neq('status', 'cancelled'),
      // 当日より前の来店履歴（新規=初回来店 判定用）
      supabase.from('bookings').select('email, customer_name')
        .eq('facility_id', facilityId).lt('booking_date', date).neq('status', 'cancelled'),
    ]);
    // Supabase はクエリ失敗時に throw せず { data:null, error } を返すため、必ず error を検査する。
    // エラー時に空配列で確定上書きすると「予約ゼロ＝空き」と誤表示し二重予約を招くため、上書きしない。
    if (staffRes.error || menuRes.error || bookingRes.error || priorRes.error) {
      setToast({ type: 'error', message: '予約・スタッフ情報の読み込みに失敗しました。再読み込みしてください' });
    }
    if (!staffRes.error) setStaffList((staffRes.data as (StaffOption & { position?: string })[]) ?? []);
    if (!menuRes.error) setMenuList((menuRes.data as MenuOption[]) ?? []);
    if (!bookingRes.error) setBookings((bookingRes.data as BoardBooking[]) ?? []);
    // 履歴取得失敗時は null（判定不能）にして「新規」バッジを誤表示しない
    setPriorKeys(priorRes.error ? null : new Set((priorRes.data as { email: string | null; customer_name: string }[] ?? []).map(custKey)));
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    setUpdatedAt(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
    setLoading(false);
  }, [facilityId, date]);

  useEffect(() => { loadData().catch(() => setLoading(false)); }, [loadData]);
  useEffect(() => { if (tab === 'suspend') { fetchAcceptStatus().catch(() => {}); loadSuspensions().catch(() => {}); } }, [tab, fetchAcceptStatus, loadSuspensions]);

  // 週/月ビュー用に期間内の予約をまとめて取得（日ビューでは未取得）
  const [rangeBookings, setRangeBookings] = useState<{ id: string; booking_date: string; start_time: string; end_time: string; status: string; customer_name: string; staff_id: string | null; menu_id: string | null }[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  useEffect(() => {
    if (view === 'day') return;
    let cancelled = false;
    (async () => {
      setRangeLoading(true);
      const sb = createBrowserSupabaseClient();
      const dates = view === 'week' ? weekDatesOf(date) : (monthGridOf(date).filter(Boolean) as string[]);
      const from = dates[0]; const to = dates[dates.length - 1];
      const res = await sb.from('bookings')
        .select('id, booking_date, start_time, end_time, status, customer_name, staff_id, menu_id')
        .eq('facility_id', facilityId).gte('booking_date', from).lte('booking_date', to).neq('status', 'cancelled')
        .order('booking_date', { ascending: true }).order('start_time', { ascending: true });
      if (cancelled) return;
      if (res.error) setToast({ type: 'error', message: '予約情報の読み込みに失敗しました。再読み込みしてください' });
      else setRangeBookings((res.data as typeof rangeBookings) ?? []);
      setRangeLoading(false);
    })().catch(() => { if (!cancelled) setRangeLoading(false); });
    return () => { cancelled = true; };
  }, [view, date, facilityId]);

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
      const { data, error } = await supabase.from('bookings')
        .select('customer_name, email, phone, booking_date')
        .eq('facility_id', facilityId).neq('status', 'cancelled')
        .order('booking_date', { ascending: false });
      // 取得失敗を「0名」と誤表示しない
      if (error) { if (!cancelled) { setToast({ type: 'error', message: 'お客様情報の取得に失敗しました' }); setCustLoading(false); } return; }
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
  }, [section, facilityId, listingReloadKey]);

  // 売上管理：当月の予約から件数・売上(total_price)を集計。DB追加不要。
  useEffect(() => {
    if (section !== 'sales') return;
    let cancelled = false;
    (async () => {
      setSalesLoading(true);
      const supabase = createBrowserSupabaseClient();
      const month = date.slice(0, 7); // YYYY-MM
      const today = getTodayString();
      // 月末は「翌月1日未満」で表現する（`${month}-31` は2月・小の月で無効日付となり
      // Postgres が 22008 エラーを返し当月売上が常に0表示になるため）
      const [my, mm] = month.split('-').map(Number);
      const nextMonthFirst = mm === 12 ? `${my + 1}-01-01` : `${my}-${String(mm + 1).padStart(2, '0')}-01`;
      const { data, error } = await supabase.from('bookings')
        .select('booking_date, total_price, status')
        .eq('facility_id', facilityId).gte('booking_date', `${month}-01`).lt('booking_date', nextMonthFirst)
        .in('status', ['confirmed', 'completed']);
      // 取得失敗を ¥0 と誤表示しない（金銭情報のため特に重要）
      if (error) { if (!cancelled) { setToast({ type: 'error', message: '売上の取得に失敗しました' }); setSales(null); setSalesLoading(false); } return; }
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
            const navSection = (['reservation', 'listing', 'customers', null, 'sales', null, null, 'billing', 'settings'] as const)[i];
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
          <button type="button" onClick={() => stepDate(-1)} aria-label={view === 'week' ? '前の週' : view === 'month' ? '前の月' : '前日'} className="px-1.5 py-1.5 border border-gray-300 rounded-l bg-white hover:bg-gray-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button ref={dateBtnRef} type="button" onClick={openDatePicker} className="flex items-center gap-1.5 px-3 py-1.5 border-y border-gray-300 bg-white hover:bg-gray-50">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="text-sm font-bold text-gray-800">{view === 'day' ? formatDateLabel(date) : view === 'week' ? (() => { const w = weekDatesOf(date); return `${parseInt(w[0].slice(5, 7), 10)}/${parseInt(w[0].slice(8), 10)}〜${parseInt(w[6].slice(5, 7), 10)}/${parseInt(w[6].slice(8), 10)}`; })() : `${date.slice(0, 4)}年${parseInt(date.slice(5, 7), 10)}月`}</span>
          </button>
          <button type="button" onClick={() => stepDate(1)} aria-label={view === 'week' ? '次の週' : view === 'month' ? '次の月' : '翌日'} className="px-1.5 py-1.5 border border-gray-300 rounded-r bg-white hover:bg-gray-50">
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
            <button key={v} type="button"
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-xs ${view === v ? 'bg-sky-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
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

      {/* グリッド（スケジュールタブ・日ビュー。内容高で終わり、下は白地。果てしない罫線を出さない） */}
      {tab === 'schedule' && view === 'day' && (
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
                      // priorKeys が null（履歴取得失敗）のときは判定不能 → 新規バッジを出さない
                      const isNew = priorKeys !== null && !priorKeys.has(custKey(item));
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

      {/* 週ビュー：7日分の予約を日別カラムで表示。日付/予約クリックで日ビューへ */}
      {tab === 'schedule' && view === 'week' && (
        <div className="flex-1 overflow-auto bg-white p-2">
          {rangeLoading ? <div className="animate-pulse p-3"><div className="h-72 bg-gray-200 rounded" /></div> : (() => {
            const today = getTodayString();
            const days = weekDatesOf(date);
            const fr = staffFilter ? rangeBookings.filter((b) => b.staff_id === staffFilter) : rangeBookings;
            return (
              <div className="grid grid-cols-7 gap-1 min-w-[700px]">
                {days.map((d) => {
                  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                  const dayBk = fr.filter((b) => b.booking_date === d);
                  return (
                    <div key={d} className={`border rounded ${d === today ? 'border-sky-400' : 'border-gray-200'}`}>
                      <button type="button" onClick={() => { setDate(d); setView('day'); }} className={`w-full px-1 py-1 text-center text-[11px] font-bold border-b hover:brightness-95 ${d === today ? 'bg-sky-100 text-sky-700 border-sky-300' : 'bg-gray-50 border-gray-200'} ${wd === 0 ? 'text-rose-500' : wd === 6 ? 'text-sky-600' : 'text-gray-600'}`}>
                        {parseInt(d.slice(8), 10)}（{WEEKDAY_JP[wd]}）
                      </button>
                      <div className="p-1 space-y-0.5 min-h-[120px]">
                        {dayBk.length === 0 ? <div className="text-[10px] text-gray-300 text-center pt-4">予約なし</div> : dayBk.map((b) => (
                          <button type="button" key={b.id} onClick={() => { setDate(d); setView('day'); }} className={`w-full text-left rounded px-1 py-0.5 text-[10px] border ${statusStyle(b.status).block} hover:brightness-95`}>
                            <span className="font-bold">{b.start_time.slice(0, 5)}</span> {b.customer_name}様{b.staff_id && <span className="block opacity-70 truncate">◆{staffName(b.staff_id)}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* 月ビュー：月カレンダー上に日別予約件数を表示。日付クリックで日ビューへ */}
      {tab === 'schedule' && view === 'month' && (
        <div className="flex-1 overflow-auto bg-white p-2">
          {rangeLoading ? <div className="animate-pulse p-3"><div className="h-72 bg-gray-200 rounded" /></div> : (() => {
            const today = getTodayString();
            const cells = monthGridOf(date);
            const fr = staffFilter ? rangeBookings.filter((b) => b.staff_id === staffFilter) : rangeBookings;
            const countByDay: Record<string, number> = {};
            for (const b of fr) countByDay[b.booking_date] = (countByDay[b.booking_date] ?? 0) + 1;
            return (
              <div className="min-w-[700px]">
                <div className="grid grid-cols-7">
                  {WEEKDAY_JP.map((w, i) => <div key={w} className={`text-center text-[11px] font-bold py-1 border-b border-gray-200 ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-600' : 'text-gray-500'}`}>{w}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {cells.map((d, i) => (
                    <div key={i} className="border border-gray-100 min-h-[72px] p-1">
                      {d && (
                        <button type="button" onClick={() => { setDate(d); setView('day'); }} className="w-full h-full text-left align-top hover:bg-sky-50 rounded">
                          <span className={`text-[11px] font-bold ${d === today ? 'bg-sky-500 text-white rounded px-1' : (i % 7 === 0 ? 'text-rose-500' : i % 7 === 6 ? 'text-sky-600' : 'text-gray-700')}`}>{parseInt(d.slice(8), 10)}</span>
                          {countByDay[d] ? <span className="block mt-1 text-[10px] text-sky-700 font-bold">予約 {countByDay[d]}件</span> : null}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
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
                  <select value={susForm.sh} onChange={(e) => setSusForm((f) => ({ ...f, sh: e.target.value }))} className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{Array.from({ length: 14 }, (_, i) => i + 9).map((h) => <option key={h} value={String(h).padStart(2, '0')}>{h}</option>)}</select><span>時</span>
                  <select value={susForm.sm} onChange={(e) => setSusForm((f) => ({ ...f, sm: e.target.value }))} className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{['00', '30'].map((m) => <option key={m} value={m}>{m}</option>)}</select><span>分</span>
                  <span className="px-1">から</span>
                  <select value={susForm.eh} onChange={(e) => setSusForm((f) => ({ ...f, eh: e.target.value }))} className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{Array.from({ length: 14 }, (_, i) => i + 9).map((h) => <option key={h} value={String(h).padStart(2, '0')}>{h}</option>)}</select><span>時</span>
                  <select value={susForm.em} onChange={(e) => setSusForm((f) => ({ ...f, em: e.target.value }))} className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">{['00', '30'].map((m) => <option key={m} value={m}>{m}</option>)}</select><span>分</span>
                  <span className="px-1">まで</span>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs text-gray-500">上記日時のネット予約受付を</span>
                  <button type="button" disabled={susBusy} onClick={createSuspension}
                    className="px-6 py-2 rounded text-sm font-bold border border-gray-400 text-gray-700 hover:bg-gray-50 disabled:opacity-40 bg-white">{susBusy ? '処理中…' : '停止する'}</button>
                  <span className="text-[11px] text-gray-400">（再開は下の一覧から「解除」）</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">※表示中の日付（{formatDateLabel(date)}）に対して時間帯を指定して停止します。日付は上部の日付ナビで切り替えてください。<br />※サロン全体（ネット予約の受付そのもの）の停止/再開は下のボタンから切り替えられます。</p>
              <div className="flex items-center gap-3 mt-2">
                <button type="button" disabled={acceptBusy || acceptStatus === 'suspended'} onClick={() => toggleAccept('suspend')} className="px-4 py-1.5 rounded text-xs font-bold border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40 bg-white">{acceptBusy ? '処理中…' : 'サロン全体を停止'}</button>
                <button type="button" disabled={acceptBusy || acceptStatus === 'published'} onClick={() => toggleAccept('resume')} className="px-4 py-1.5 rounded text-xs font-bold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-40">{acceptBusy ? '処理中…' : 'サロン全体を再開'}</button>
                {acceptStatus === 'suspended' && <span className="text-xs text-rose-600 font-bold">現在サロン全体が停止中です</span>}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">■ 一括停止中の時間帯一覧</h3>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-600 space-y-2">
                {suspensions.length === 0
                  ? <span className="text-gray-400">現在、ネット予約受付を一括停止中の時間帯はありません。</span>
                  : suspensions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between border-b border-gray-100 last:border-0 pb-1.5">
                      <span className="text-gray-700"><span className="font-bold">{s.suspend_date}</span> {s.start_time.slice(0, 5)} 〜 {s.end_time.slice(0, 5)}</span>
                      <button type="button" disabled={susBusy} onClick={() => deleteSuspension(s.id)} className="px-3 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40">解除</button>
                    </div>
                  ))}
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

      {/* ===== 掲載管理セクション（HPB準拠：二次ナビ＋10サブ画面） ===== */}
      {section === 'listing' && (
        listingLoading || !listing ? (
          <div className="flex-1 overflow-auto bg-gray-50 p-4"><div className="animate-pulse"><div className="h-48 bg-gray-200 rounded max-w-2xl" /></div></div>
        ) : (
          <ListingBoard facilityId={facilityId} salonName={listing.name} status={listing.status} onToast={(message) => setToast({ type: 'success', message })} onReloadStatus={() => setListingReloadKey((k) => k + 1)} />
        )
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

      {/* ===== 振込・請求セクション（CareLink の掲載は無料・請求なし #60） ===== */}
      {section === 'billing' && (
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          <div className="max-w-2xl space-y-4">
            <div className="text-sm font-bold text-gray-800">振込・請求</div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="text-sm font-bold text-emerald-700 mb-1">CareLink の掲載は無料でご利用いただけます。</div>
              <p className="text-xs text-emerald-700/80 leading-relaxed">掲載料・成果報酬・送客手数料などのご請求はありません。現在お支払いいただく費用はございません。</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold text-gray-600 mb-2">ご請求一覧</div>
              <div className="py-8 text-center text-gray-400 text-sm">ご請求はありません（無料プランをご利用中）</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-bold text-gray-600 mb-1">ご利用プラン</div>
              <div className="flex items-center gap-2"><span className="text-base font-bold text-gray-800">無料プラン</span><span className="text-[10px] text-emerald-600 border border-emerald-300 bg-emerald-50 rounded px-1.5 py-0.5">¥0 / 月</span></div>
            </div>
          </div>
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
              {custDetail.error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2">来店履歴の取得に失敗しました。再度開き直してください。</div>
              )}
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
              {/* カルテ編集（メモ/タグ/次回案内） #42-#45 */}
              <div className="border-t pt-3 space-y-3">
                <div className="text-xs font-bold text-gray-600">カルテ（メモ・タグ・次回案内）</div>
                <div>
                  <label className="text-[11px] text-gray-500">顧客メモ</label>
                  <textarea value={karteEdit.note} onChange={(e) => setKarteEdit((k) => ({ ...k, note: e.target.value }))} rows={3} maxLength={2000} placeholder="施術内容・好み・アレルギー等の自由メモ" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500">タグ（カンマ区切り・最大20）</label>
                  <input value={karteEdit.tags} onChange={(e) => setKarteEdit((k) => ({ ...k, tags: e.target.value }))} placeholder="VIP, 敏感肌, 指名" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                  <div className="flex flex-wrap gap-1 mt-1">{karteEdit.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t, i) => <span key={`${t}-${i}`} className="px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded text-[10px]">{t}</span>)}</div>
                </div>
                <div className="flex items-end gap-2">
                  <div><label className="text-[11px] text-gray-500 block">次回案内日</label><input type="date" value={karteEdit.nextDate} onChange={(e) => setKarteEdit((k) => ({ ...k, nextDate: e.target.value }))} className="border border-gray-300 rounded px-2 py-1 text-xs" /></div>
                  <div className="flex-1"><label className="text-[11px] text-gray-500 block">次回案内メモ</label><input value={karteEdit.nextNote} onChange={(e) => setKarteEdit((k) => ({ ...k, nextNote: e.target.value }))} maxLength={200} placeholder="次回◯◯のご案内 等" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" /></div>
                </div>
                <div className="text-right"><button type="button" disabled={karteSaving} onClick={saveKarte} className="px-4 py-1.5 bg-sky-500 text-white text-xs font-bold rounded disabled:opacity-50">{karteSaving ? '保存中…' : 'カルテを保存'}</button></div>
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
