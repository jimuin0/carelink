import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import type { Database } from '@/types/database.types';
import Link from 'next/link';
import BoardScheduleGrid, { type BoardRow, type BoardMenu } from '@/components/admin/BoardScheduleGrid';
import { todayJst, isValidIsoDate, addDays } from '@/lib/admin-date';

/**
 * サロンボード（HPB サロンボード型・スタッフ×時間軸ガントビュー / CareLink 色）
 *
 * - 行: スタッフ（is_active・sort_order 順）＋「指名なし」（staff_id null の予約）
 * - 列: 時間軸 OPEN_HOUR〜CLOSE_HOUR（30分グリッド）
 * - 予約チップ: ステータス色（確認待ち=琥珀 / 確定=sky / 完了=グレー、@/lib/booking-status に集約）で帯表示、クリックで予約詳細へ
 * - 上部: 日付送り（◀ 前日 / 翌日 ▶・今日）
 */

export const dynamic = 'force-dynamic';

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;

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

  // 時間軸の区切り幅（店舗設定 board_slot_minutes）。15/30/60 のみ許可・既定 60。
  // 取得失敗（列未追加＝migration 未適用 等）や想定外値は 60 にフォールバックし、
  // サロンボード本体は決して落とさない（設定は非クリティカル）。
  const ALLOWED_SLOT_MINUTES = [15, 30, 60] as const;
  const { data: slotRow } = await supabase
    .from('facility_profiles')
    .select('board_slot_minutes')
    .eq('id', membership.facility_id)
    .maybeSingle();
  const rawSlot = (slotRow as { board_slot_minutes?: number | null } | null)?.board_slot_minutes;
  const slotMinutes = ALLOWED_SLOT_MINUTES.includes(rawSlot as 15 | 30 | 60) ? (rawSlot as number) : 60;

  const date = searchParams.date && isValidIsoDate(searchParams.date)
    ? searchParams.date
    : todayJst();

  // 生成済みDBスキーマ型を効かせたクライアント。これにより staff_profiles /
  // facility_menus への列指定が tsc（CI: `tsc --noEmit`）で検証され、存在しない列
  // （例: facility_menus.is_active）を参照した場合はマージ前にビルドが失敗する＝
  // 「存在しない列を本番まで素通りさせる」クラスのバグを発症前に遮断する。
  // bookings は埋め込み（menu:facility_menus(name)）の生成型と既存の手動キャストが
  // 競合するため、本 PR のスコープを越えないよう従来の supabase（非型付き）に据え置く。
  const db = supabase as SupabaseClient<Database>;

  const [{ data: staffRows, error: staffErr }, { data: bookingRows, error: bookingErr }, { data: menuRows, error: menuErr }] = await Promise.all([
    db
      .from('staff_profiles')
      .select('id, name, position, nomination_fee')
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
    db
      .from('facility_menus')
      // facility_menus に is_active 列は存在しない（is_featured / is_published のみ）。
      // 公開/有効トグルは UI・API ともに無く、他のメニュー取得（/api/admin/menus・
      // /api/admin/bookings・packages）は facility_id のみで全件取得する。本ボードの
      // 新規予約モーダルも同一集合を出すのが正なので、ここも facility_id だけで取得する。
      .select('id, name, price, duration_minutes')
      .eq('facility_id', membership.facility_id)
      .order('sort_order', { ascending: true }),
  ]);

  // 取得失敗を「空状態」に偽装しない（error を握り潰さず error.tsx に委ねる）。
  // 0件（空）と取得失敗を必ず区別する。
  if (staffErr || bookingErr || menuErr) {
    throw new Error(`サロンボードのデータ取得に失敗しました: ${staffErr?.message ?? bookingErr?.message ?? menuErr?.message}`);
  }

  const staff = staffRows ?? [];
  type BookingChip = {
    id: string; customer_name: string; start_time: string; end_time: string;
    status: string; staff_id: string | null; menu: { name: string } | { name: string }[] | null;
  };
  const bookings = (bookingRows ?? []) as BookingChip[];
  const boardMenus: BoardMenu[] = (menuRows ?? []) as BoardMenu[];

  // 行 = スタッフ + 「指名なし」（staff_id null か、スタッフ一覧に居ない id）
  const staffIds = new Set(staff.map((s) => s.id));
  const menuNameOf = (b: BookingChip): string | null => {
    const menu = Array.isArray(b.menu) ? b.menu[0] : b.menu;
    return menu?.name ?? null;
  };
  const chipsFor = (key: string) =>
    bookings
      .filter((b) => (key === '__unassigned__' ? !b.staff_id || !staffIds.has(b.staff_id) : b.staff_id === key))
      .map((b) => ({
        id: b.id, customer_name: b.customer_name, start_time: b.start_time,
        end_time: b.end_time, status: b.status, menuName: menuNameOf(b),
      }));
  const boardRows: BoardRow[] = [
    ...staff.map((s) => ({
      key: s.id, name: s.name, position: s.position,
      nominationFee: s.nomination_fee ?? 0, chips: chipsFor(s.id),
    })),
    { key: '__unassigned__', name: '指名なし', position: null, nominationFee: 0, chips: chipsFor('__unassigned__') },
  ];

  // 時間軸ヘッダ（1時間刻み）
  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

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
      </div>

      {/* ガント本体 */}
      <div className="bg-white border rounded-b-xl overflow-x-auto">
        <div className="min-w-[900px]">
          {/* 時間軸ヘッダ
              縦 sticky にしない: 親が overflow-x-auto（横スクロール）のため、縦 sticky に
              すると sticky の包含ブロックがこのスクロールコンテナになり、ページ縦スクロール時に
              ヘッダが盤面トップに固定されず行（例: 2人目）の上へ「降りてきて」重なる不具合が出る。
              通常フローの先頭要素にすることで、ヘッダは常に盤面最上段に並び、行へ重なり得ない。
              スタッフ列の横 sticky（sticky left-0）は横スクロール追従のため維持する。 */}
          <div className="flex border-b bg-sky-50">
            <div className="w-36 shrink-0 px-3 py-2 text-xs font-bold text-gray-600 border-r sticky left-0 z-30 bg-sky-50">スタッフ</div>
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

          {/* スタッフ行（クライアント: 空き帯クリックで新規予約モーダル） */}
          <BoardScheduleGrid
            facilityId={membership.facility_id}
            date={date}
            openHour={OPEN_HOUR}
            closeHour={CLOSE_HOUR}
            rows={boardRows}
            menus={boardMenus}
            slotMinutes={slotMinutes}
          />

          {staff.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400">
              アクティブなスタッフが登録されていません。<Link href="/admin/staff/new" className="text-sky-600 underline">スタッフを登録</Link>すると、スタッフ別のスケジュールが表示されます。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
