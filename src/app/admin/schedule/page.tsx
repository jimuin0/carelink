import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import type { Database } from '@/types/database.types';
import Link from 'next/link';
import BoardScheduleGrid, { type BoardRow, type BoardMenu } from '@/components/admin/BoardScheduleGrid';
import { todayJst, isValidIsoDate, addDays } from '@/lib/admin-date';
import { computeBoardHourRange } from '@/lib/board-time';
import { dayOrder } from '@/lib/constants';

/**
 * サロンボード（HPB サロンボード型・スタッフ×時間軸ガントビュー / CareLink 色）
 *
 * - 行: スタッフ（is_active・sort_order 順）＋「指名なし」（staff_id null の予約）
 * - 列: 時間軸。表示帯は店舗の営業時間（business_hours の当該曜日）から算出し、未設定時は
 *   既定 8〜22 時にフォールバック。枠外予約があれば前後へ自動拡張（computeBoardHourRange）
 * - 予約チップ: ステータス色（確認待ち=琥珀 / 確定=sky / 受付=emerald / 完了=グレー、@/lib/booking-status に集約）で帯表示、クリックで予約詳細へ
 * - 上部: 日付送り（◀ 前日 / 翌日 ▶・今日）
 */

export const dynamic = 'force-dynamic';

// 表示時間帯の既定（フォールバック）。店舗の営業時間（business_hours）が未設定・休業日・
// 不正値のときに使う。営業時間が設定されていればそちらを優先し、店舗は「設定→営業時間」を
// 変えるだけでボードの表示帯を変更できる（固定値を撤廃）。
const DEFAULT_OPEN_HOUR = 8;
const DEFAULT_CLOSE_HOUR = 22;

// 盤面の横幅設計。1時間あたりの表示幅を固定（px）にして時間軸の間隔を確保し、
// 画面幅を超える分は横スクロール（親の overflow-x-auto）で見せる（HPB サロンボード型）。
// 値は HPB サロンボード実機の実測に合わせる：1コマ（emulateCell）= 23px ＝ 10分。
// よって 10分=23px → 1時間 = 23×6 = 138px（予約枠 width 132px ともほぼ一致）。
const HOUR_PX = 138;
const NAME_COL_PX = 144; // スタッフ名列 w-36 = 9rem = 144px と一致させる

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
      .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!membership) notFound();

  // 時間軸の区切り幅（店舗設定 board_slot_minutes）。15/30/60 のみ許可・既定 60。
  // 取得失敗（列未追加＝migration 未適用 等）や想定外値は 60 にフォールバックし、
  // サロンボード本体は決して落とさない（設定は非クリティカル）。
  const ALLOWED_SLOT_MINUTES = [15, 30, 60] as const;
  const { data: slotRow } = await supabase
    .from('facility_profiles')
    .select('board_slot_minutes, business_hours')
    .eq('id', membership.facility_id)
    .maybeSingle();
  const rawSlot = (slotRow as { board_slot_minutes?: number | null } | null)?.board_slot_minutes;
  const slotMinutes = ALLOWED_SLOT_MINUTES.includes(rawSlot as 15 | 30 | 60) ? (rawSlot as number) : 60;
  // 営業時間（曜日別）。型は JSONB のため緩く受け、当該曜日の open/close のみ後で参照する。
  const businessHours = (slotRow as { business_hours?: Record<string, { open?: string | null; close?: string | null } | null> | null } | null)?.business_hours ?? null;

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

  // 表示日の曜日（JST 暦日・dayOrder は mon 始まり）の営業時間を取り出す。
  // getUTCDay は 0=日…6=土。dayOrder（mon=0）への変換は (n+6)%7。
  const [yy, mm, dd] = date.split('-').map(Number);
  const dowUtc = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
  const dayKey = dayOrder[(dowUtc + 6) % 7];
  const dayBusiness = businessHours?.[dayKey] ?? null;
  // 表示時間帯 = 営業時間（無ければ既定）を基準に、枠外予約があれば前後へ自動拡張。
  const { openHour, closeHour } = computeBoardHourRange(
    dayBusiness,
    bookings.map((b) => ({ start_time: b.start_time, end_time: b.end_time })),
    DEFAULT_OPEN_HOUR,
    DEFAULT_CLOSE_HOUR,
  );

  // 時間軸ヘッダ（1時間刻み）
  const hours = Array.from({ length: closeHour - openHour }, (_, i) => openHour + i);
  // 盤面の最小幅 = スタッフ名列 + 表示時間 × 1時間あたり幅。これを下回ると横スクロールになる。
  const boardMinWidth = NAME_COL_PX + (closeHour - openHour) * HOUR_PX;

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
        <div style={{ minWidth: boardMinWidth }}>
          {/* 時間軸ヘッダ
              縦 sticky にしない: 親が overflow-x-auto（横スクロール）のため、縦 sticky に
              すると sticky の包含ブロックがこのスクロールコンテナになり、ページ縦スクロール時に
              ヘッダが盤面トップに固定されず行（例: 2人目）の上へ「降りてきて」重なる不具合が出る。
              通常フローの先頭要素にすることで、ヘッダは常に盤面最上段に並び、行へ重なり得ない。
              スタッフ列の横 sticky（sticky left-0）は横スクロール追従のため維持する。 */}
          <div className="flex border-b bg-sky-50">
            <div className="w-36 shrink-0 px-3 py-2 text-xs font-bold text-gray-600 border-r sticky left-0 z-30 bg-sky-50">スタッフ</div>
            <div className="flex-1 relative h-8">
              {/* 30分の補助目盛り（短い淡破線）— 本体の罫線リズムと軸を揃える */}
              {hours.map((h, i) => (
                <div
                  key={`half-${h}`}
                  className="absolute top-4 bottom-0 border-l border-dashed border-sky-100"
                  style={{ left: `${((i + 0.5) / hours.length) * 100}%` }}
                />
              ))}
              {/* 毎時ラベル＋実線（強調） */}
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-sky-200 text-[10px] font-semibold text-gray-600 pl-1 pt-2"
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
            openHour={openHour}
            closeHour={closeHour}
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
