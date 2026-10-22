import type { AvailableSlot } from '@/types';

/**
 * /api/slots/week（スタッフ×最大7日の空き枠を 1 リクエストで返す）の呼び出し側の共通処理。
 *
 * 予約画面（BookingFlow）と予約日時の変更画面（/mypage/bookings/[id]/change）が使う。
 * 変更画面は以前、おまかせ予約のときスタッフの人数ぶん /api/slots を同時に叩いており、
 * IP あたりの上限（毎分30回）に当たった 429 や取得失敗を「空き枠なし」として表示していた
 * （2026年10月22日に week ルートへ寄せた）。
 */

/** 1 リクエストで渡せるスタッフ数の上限（サーバー側の検証と同じ値を使う）。 */
export const SLOTS_WEEK_MAX_STAFF = 10;
/** 1 リクエストで渡せる日付数の上限（サーバー側の検証と同じ値を使う）。 */
export const SLOTS_WEEK_MAX_DATES = 7;

/** date -> staffId -> その日の空き枠。 */
export type SlotsByDateAndStaff = Record<string, Record<string, AvailableSlot[]>>;

export type SlotsWeekResult =
  | { ok: true; days: SlotsByDateAndStaff; bookingAvailable: boolean }
  | { ok: false };

/** スタッフ ID を上限ごとのグループに分ける（順序は保つ）。 */
export function chunkStaffIds(staffIds: string[], size: number = SLOTS_WEEK_MAX_STAFF): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < staffIds.length; i += size) groups.push(staffIds.slice(i, i + size));
  return groups;
}

/**
 * 指定スタッフ・日付の空き枠を取得する。スタッフが上限を超えるときはグループに分けて並列に取得する。
 *
 * 1 グループでも失敗（HTTP エラー・429・形の違う応答）したら { ok: false } を返す。
 * 一部だけの結果を返すと、取れなかったスタッフの枠が「満席」に見えてしまうため。
 * 中断（AbortSignal）は失敗ではないので、例外のまま呼び出し側へ渡す。
 */
export async function fetchSlotsWeek(params: {
  facilityId: string;
  staffIds: string[];
  dates: string[];
  duration: number;
  signal?: AbortSignal;
}): Promise<SlotsWeekResult> {
  const days: SlotsByDateAndStaff = {};
  let failed = false;
  let bookingAvailable = true;
  await Promise.all(chunkStaffIds(params.staffIds).map(async (group) => {
    const query = new URLSearchParams({
      facilityId: params.facilityId,
      staffIds: group.join(','),
      dates: params.dates.join(','),
      duration: String(params.duration),
    });
    const res = await fetch(`/api/slots/week?${query}`, { signal: params.signal });
    const body = res.ok ? await res.json().catch(() => null) : null;
    if (!body || typeof body.days !== 'object' || body.days === null) { failed = true; return; }
    if (body.bookingAvailable === false) bookingAvailable = false;
    for (const [date, perStaff] of Object.entries(body.days as SlotsByDateAndStaff)) {
      days[date] = { ...days[date], ...perStaff };
    }
  }));
  return failed ? { ok: false } : { ok: true, days, bookingAvailable };
}

/**
 * 1 日分のスタッフ別空き枠を、開始時刻ごとに 1 枠へまとめる（おまかせ予約用）。
 * 同じ開始時刻に複数のスタッフが空いているときは staffIds の順（＝表示順）で先のスタッフを採る。
 * 結果は開始時刻の昇順で、各枠に担当候補の staff_id を付ける。
 */
export function mergeSlotsInStaffOrder(
  staffIds: string[],
  perStaff: Record<string, AvailableSlot[]> | undefined,
): AvailableSlot[] {
  const byStart = new Map<string, AvailableSlot>();
  for (const staffId of staffIds) {
    for (const slot of perStaff?.[staffId] ?? []) {
      if (!byStart.has(slot.slot_start)) byStart.set(slot.slot_start, { ...slot, staff_id: staffId });
    }
  }
  return Array.from(byStart.values()).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
}
