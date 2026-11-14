import type { createBrowserSupabaseClient } from './supabase-browser';
import { fetchAllPaged } from './paginate';
import { csvEscape } from './csv';

/**
 * 設定画面（/admin/settings）の「予約データCSVダウンロード」（2026年10月22日に page.tsx から切り出し）。
 *
 * 🔴 以前は `.limit(5000)` の 1 回読みだったが、PostgREST の max_rows（1000 行）が優先されるため
 * 【1000 件で黙って打ち切られていた】。エラーにはならず、`data.length >= 5000` の警告も
 * 本番では成り立たないので「CSVをダウンロードしました」とだけ出て、古い予約が CSV から抜け落ちていた。
 *
 * 1000 件ずつページングして上限（5000 件）まで読む。並び順に id を加えてページの境界で
 * 行が重複・欠落しないようにする。上限ちょうどで止まったときは、その先に 1 件でも残っているかを
 * 1 行だけ読んで確かめ、本当に切り捨てたときだけ truncated=true を返す（ちょうど 5000 件の施設に
 * 「切り捨てた」と誤って伝えない）。
 */
export const BOOKING_CSV_MAX_ROWS = 5000;

const COLUMNS = 'id, booking_date, end_date, start_time, end_time, customer_name, email, phone, status, total_price, note, created_at';

export type BookingCsvRow = {
  id: string;
  booking_date: string;
  end_date?: string | null;
  start_time: string;
  end_time: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  total_price: number | null;
  note: string | null;
  created_at: string | null;
};

type BrowserClient = ReturnType<typeof createBrowserSupabaseClient>;

export async function readBookingCsvRows(
  db: BrowserClient, facilityId: string,
): Promise<{ rows: BookingCsvRow[]; truncated: boolean; error: unknown }> {
  const page = async (offset: number, limit: number) => {
    const { data, error } = await db
      .from('bookings')
      .select(COLUMNS)
      .eq('facility_id', facilityId)
      .order('booking_date', { ascending: false })
      .order('start_time', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    return { data, error };
  };
  const { rows, error, truncated } = await fetchAllPaged<BookingCsvRow>(page, { pageSize: 1000, maxRows: BOOKING_CSV_MAX_ROWS });
  if (error) return { rows: [], truncated: false, error };
  if (!truncated) return { rows, truncated: false, error: null };
  const rest = await page(BOOKING_CSV_MAX_ROWS, 1);
  if (rest.error) return { rows: [], truncated: false, error: rest.error };
  return { rows, truncated: (rest.data?.length ?? 0) > 0, error: null };
}

const HEADERS = ['予約ID', '予約日', '開始時間', '終了時間', '顧客名', 'メール', '電話', 'ステータス', '金額', '備考', '作成日'];

/** Excel で文字化けしないよう BOM を付ける。セルは csvEscape（数式インジェクション対策込み）。 */
export function buildBookingCsv(rows: readonly BookingCsvRow[]): string {
  const lines = [
    HEADERS.join(','),
    ...rows.map((r) => [r.id, r.booking_date, r.start_time, r.end_date && r.end_date !== r.booking_date ? `${r.end_date} ${r.end_time}` : r.end_time, r.customer_name, r.email, r.phone, r.status,
      r.total_price, r.note, r.created_at].map(csvEscape).join(',')),
  ];
  return `﻿${lines.join('\n')}`;
}
