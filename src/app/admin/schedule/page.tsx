import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import { statusGanttClass, bookingStatusLabel } from '@/lib/booking-status';

/**
 * サロンボード（HPB サロンボード型・スタッフ×時間軸ガントビュー / CareLink 色）
 *
 * - 行: スタッフ（is_active・sort_order 順）＋「指名なし」（staff_id null の予約）
 * - 列: 時間軸 OPEN_HOUR〜CLOSE_HOUR（30分グリッド）
 * - 予約チップ: ステータス色（確認待ち=琥珀 / 確定=sky / 完了=グレー、@/lib/booking-status に集約）で帯表示、クリックで予約詳細へ
 * - 上部: 日付送り（◀ 当日 ▶・今日）、下部: 月内日付ストリップ
 */

export const dynamic = 'force-dynamic';

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;
const TOTAL_MIN = (CLOSE_HOUR - OPEN_HOUR) * 60;

// ガント上に現れるステータスのみ凡例に出す（cancelled / cancel_fee_paid は帯に出ない）
const LEGEND_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'] as const;

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** JST の今日 (YYYY-MM-DD) */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatJp(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${wd}）`;
}

interface Props {
  searchParams: Promise<{ date?: string }>;
}

export default async function AdminSchedulePage(props: Props) {
  const searchParams = await props.searchParams;
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
    ? searchParams.date
    : todayJst();

  const [{ data: staffRows }, { data: bookingRows }] = await Promise.all([
    supabase
      .from('staff_profiles')
      .select('id, name, position')
      .eq('facility_id', membership.facility_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('bookings')
      .select('id, customer_name, start_time, end_time, status, staff_id, menu:facility_menus(name)')
      .eq('facility_id', membership.facility_id)
      .eq('booking_date', date)
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true }),
  ]);

  const staff = staffRows ?? [];
  type BookingChip = {
    id: string; customer_name: string; start_time: string; end_time: string;
    status: string; staff_id: string | null; menu: { name: string } | { name: string }[] | null;
  };
  const bookings = (bookingRows ?? []) as BookingChip[];

  // 行 = スタッフ + 「指名なし」（staff_id null か、スタッフ一覧に居ない id）
  const staffIds = new Set(staff.map((s) => s.id));
  const rows: { key: string; name: string; position: string | null }[] = [
    ...staff.map((s) => ({ key: s.id, name: s.name, position: s.position })),
    { key: '__unassigned__', name: '指名なし', position: null },
  ];
  const rowBookings = (key: string) =>
    bookings.filter((b) => (key === '__unassigned__' ? !b.staff_id || !staffIds.has(b.staff_id) : b.staff_id === key));

  // 時間軸ヘッダ（1時間刻み）
  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

  // 月内日付ストリップ
  const [y, m] = date.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayJst();

  return (
    <div>
      {/* ツールバー（日付送り・HPB型） */}
      <div className="bg-white rounded-t-xl border border-b-0 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/admin/schedule?date=${addDays(date, -1)}`} aria-label="前日" className="w-8 h-8 inline-flex items-center justify-center rounded border bg-white hover:bg-sky-50 text-sky-700 font-bold">◀</Link>
          <span className="px-3 text-lg font-extrabold text-gray-800 whitespace-nowrap">{formatJp(date)}</span>
          <Link href={`/admin/schedule?date=${addDays(date, 1)}`} aria-label="翌日" className="w-8 h-8 inline-flex items-center justify-center rounded border bg-white hover:bg-sky-50 text-sky-700 font-bold">▶</Link>
          {date !== today && (
            <Link href="/admin/schedule" className="ml-2 px-3 py-1 text-xs font-bold rounded-full bg-sky-600 text-white hover:bg-sky-700">今日</Link>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {/* 凡例 */}
          {LEGEND_STATUSES.map((k) => (
            <span key={k} className={`px-2 py-0.5 rounded border ${statusGanttClass(k)}`}>{bookingStatusLabel(k)}</span>
          ))}
          <Link href={`/admin/bookings?date=${date}`} className="ml-2 px-3 py-1.5 rounded border border-sky-300 text-sky-700 font-bold hover:bg-sky-50">予約一覧</Link>
        </div>
      </div>

      {/* ガント本体 */}
      <div className="bg-white border rounded-b-xl overflow-x-auto">
        <div className="min-w-[900px]">
          {/* 時間軸ヘッダ */}
          <div className="flex border-b bg-sky-50/60 sticky top-0">
            <div className="w-36 shrink-0 px-3 py-2 text-xs font-bold text-gray-600 border-r">スタッフ</div>
            <div className="flex-1 relative h-8">
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-sky-100 text-[10px] text-gray-500 pl-1 pt-2"
                  style={{ left: `${(i / hours.length) * 100}%` }}
                >
                  {h}:00
                </div>
              ))}
            </div>
          </div>

          {/* スタッフ行 */}
          {rows.map((row) => {
            const chips = rowBookings(row.key);
            return (
              <div key={row.key} className="flex border-b last:border-b-0 hover:bg-sky-50/30">
                <div className="w-36 shrink-0 px-3 py-2 border-r">
                  <p className="text-sm font-bold text-gray-800 truncate">{row.name}</p>
                  {row.position && <p className="text-[10px] text-gray-400 truncate">{row.position}</p>}
                </div>
                <div className="flex-1 relative h-14">
                  {/* 30分グリッド線 */}
                  {hours.map((h, i) => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: `${(i / hours.length) * 100}%` }} />
                  ))}
                  {/* 予約チップ */}
                  {chips.map((b) => {
                    const start = Math.max(toMin(b.start_time) - OPEN_HOUR * 60, 0);
                    const end = Math.min(toMin(b.end_time) - OPEN_HOUR * 60, TOTAL_MIN);
                    if (end <= 0 || start >= TOTAL_MIN) return null; // 営業時間帯の外は非表示
                    const left = (start / TOTAL_MIN) * 100;
                    const width = Math.max(((end - start) / TOTAL_MIN) * 100, 2);
                    const menu = Array.isArray(b.menu) ? b.menu[0] : b.menu;
                    return (
                      <Link
                        key={b.id}
                        href={`/admin/bookings/${b.id}`}
                        className={`absolute top-1.5 bottom-1.5 rounded border-l-4 px-1.5 py-0.5 overflow-hidden shadow-sm hover:shadow transition-shadow ${statusGanttClass(b.status)}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${b.customer_name} 様 ${b.start_time.slice(0, 5)}〜${b.end_time.slice(0, 5)}${menu?.name ? ` / ${menu.name}` : ''}`}
                      >
                        <p className="text-[11px] font-bold truncate leading-tight">{b.customer_name} 様</p>
                        <p className="text-[10px] truncate leading-tight">{b.start_time.slice(0, 5)}〜{b.end_time.slice(0, 5)}{menu?.name ? ` ${menu.name}` : ''}</p>
                      </Link>
                    );
                  })}
                  {chips.length === 0 && (
                    <p className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-300 select-none">予約なし</p>
                  )}
                </div>
              </div>
            );
          })}

          {staff.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400">
              アクティブなスタッフが登録されていません。<Link href="/admin/staff/new" className="text-sky-600 underline">スタッフを登録</Link>すると、スタッフ別のスケジュールが表示されます。
            </div>
          )}
        </div>
      </div>

      {/* 月内日付ストリップ（HPB下部の日付送り） */}
      <div className="mt-3 bg-white border rounded-xl px-3 py-2 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          <span className="text-xs font-bold text-gray-500 pr-2">{m}月</span>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const active = ds === date;
            const isToday = ds === today;
            return (
              <Link
                key={d}
                href={`/admin/schedule?date=${ds}`}
                className={`w-7 h-7 inline-flex items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  active ? 'bg-sky-600 text-white' : isToday ? 'border border-sky-400 text-sky-700' : 'text-gray-600 hover:bg-sky-50'
                }`}
              >
                {d}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
