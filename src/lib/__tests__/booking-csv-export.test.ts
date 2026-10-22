/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 設定画面の「予約データCSVダウンロード」（2026年10月22日）。
 *
 * 回帰の中身: 以前は `.limit(5000)` の 1 回読みで、PostgREST の max_rows（1000 行）により
 * 【1000 件で黙って打ち切られていた】。`data.length >= 5000` の警告も本番では成り立たず、
 * 「CSVをダウンロードしました」とだけ出て古い予約が CSV から抜け落ちていた。
 */
import { BOOKING_CSV_MAX_ROWS, buildBookingCsv, readBookingCsvRows, type BookingCsvRow } from '../booking-csv-export';

const FACILITY = 'ab160000-0000-4000-8000-000000000001';

function row(n: number, extra: Partial<BookingCsvRow> = {}): BookingCsvRow {
  return {
    id: `id-${n}`, booking_date: '2026-10-01', start_time: '10:00:00', end_time: '11:00:00', customer_name: `顧客${n}`,
    email: null, phone: null, status: 'completed', total_price: 1000, note: null, created_at: '2026-09-01T00:00:00+00:00', ...extra,
  };
}

/**
 * 実際の PostgREST と同じく、1 回の応答は最大 1000 行（max_rows）。`total` 件の予約がある施設を模す。
 * range(offset, end) の要求に対し、max_rows を超える分は黙って返さない。
 */
function client(total: number, fail?: { atOffset: number }) {
  const ranges: [number, number][] = [];
  const calls: { method: string; args: unknown[] }[] = [];
  const db = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order']) chain[method] = (...args: unknown[]) => { calls.push({ method, args }); return chain; };
      chain.range = (from: number, to: number) => {
        ranges.push([from, to]);
        if (fail && from === fail.atOffset) return Promise.resolve({ data: null, error: { code: '57014' } });
        const end = Math.min(to, from + 999, total - 1);
        const data = end < from ? [] : Array.from({ length: end - from + 1 }, (_, i) => row(from + i));
        return Promise.resolve({ data, error: null });
      };
      // 旧実装の `.limit(5000)`（max_rows が優先されて 1000 行しか返らない）
      chain.limit = (n: number) => Promise.resolve({ data: Array.from({ length: Math.min(n, 1000, total) }, (_, i) => row(i)), error: null });
      return chain;
    },
  };
  return { db: db as unknown as Parameters<typeof readBookingCsvRows>[0], ranges, calls };
}

describe('readBookingCsvRows', () => {
  test('1000 件を超える予約を全件読む（1000 件で黙って打ち切らない）', async () => {
    const { db, ranges } = client(2500);
    const { rows, truncated, error } = await readBookingCsvRows(db, FACILITY);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    expect(truncated).toBe(false);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  test('その施設の予約だけを、予約日の新しい順・同日は時刻と id で一意に並べて読む', async () => {
    const { db, calls } = client(3);
    await readBookingCsvRows(db, FACILITY);
    expect(calls).toEqual([
      { method: 'from', args: ['bookings'] },
      { method: 'select', args: ['id, booking_date, start_time, end_time, customer_name, email, phone, status, total_price, note, created_at'] },
      { method: 'eq', args: ['facility_id', FACILITY] },
      { method: 'order', args: ['booking_date', { ascending: false }] },
      { method: 'order', args: ['start_time', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
    ]);
  });

  test('上限（5000 件）を超えるときは 5000 件で止め、切り捨てたことを返す', async () => {
    const { db, ranges } = client(7000);
    const { rows, truncated, error } = await readBookingCsvRows(db, FACILITY);
    expect(error).toBeNull();
    expect(rows).toHaveLength(BOOKING_CSV_MAX_ROWS);
    expect(truncated).toBe(true);
    expect(ranges.at(-1)).toEqual([5000, 5000]); // 続きが 1 件でもあるかの確認
  });

  test('ちょうど 5000 件なら全件そろっているので「切り捨て」とは言わない', async () => {
    const { db } = client(5000);
    const { rows, truncated } = await readBookingCsvRows(db, FACILITY);
    expect(rows).toHaveLength(5000);
    expect(truncated).toBe(false);
  });

  test('途中のページで失敗したら部分的な CSV を作らない', async () => {
    const { db } = client(2500, { atOffset: 1000 });
    const { rows, truncated, error } = await readBookingCsvRows(db, FACILITY);
    expect(error).toEqual({ code: '57014' });
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  test('上限を超えたかの確認で失敗したら部分的な CSV を作らない', async () => {
    const { db } = client(7000, { atOffset: 5000 });
    const { rows, error } = await readBookingCsvRows(db, FACILITY);
    expect(error).toEqual({ code: '57014' });
    expect(rows).toEqual([]);
  });

  test('予約が 0 件なら空を返す', async () => {
    const { db } = client(0);
    expect(await readBookingCsvRows(db, FACILITY)).toEqual({ rows: [], truncated: false, error: null });
  });

  test('確認の応答が data=null でも「続きなし」と扱う', async () => {
    const { db } = client(5000);
    const original = (db as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (db as unknown as { from: (t: string) => Record<string, unknown> }).from = (table: string) => {
      const chain = original(table);
      const range = chain.range as (a: number, b: number) => Promise<unknown>;
      chain.range = (from: number, to: number) => (from === 5000 ? Promise.resolve({ data: null, error: null }) : range(from, to));
      return chain;
    };
    const { rows, truncated } = await readBookingCsvRows(db, FACILITY);
    expect(rows).toHaveLength(5000);
    expect(truncated).toBe(false);
  });
});

describe('buildBookingCsv', () => {
  test('BOM・見出し・全項目を出し、数式になりうる値と区切り文字を無害化する', () => {
    const csv = buildBookingCsv([
      row(1, { customer_name: '=HYPERLINK("x")', email: 'a@example.invalid', phone: '090-0000-0000', note: '改行\nあり, カンマ', total_price: null }),
    ]);
    expect(csv.startsWith('﻿予約ID,予約日,開始時間,終了時間,顧客名,メール,電話,ステータス,金額,備考,作成日\n')).toBe(true);
    const line = csv.split('\n').slice(1).join('\n');
    expect(line).toBe(`id-1,2026-10-01,10:00:00,11:00:00,"'=HYPERLINK(""x"")",a@example.invalid,090-0000-0000,completed,,"改行\nあり, カンマ",2026-09-01T00:00:00+00:00`);
  });
});
