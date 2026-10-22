import { jstDayStartIso, jstMonthInfo, jstMonthStartIso } from './admin-date';

/**
 * 利用状況分析（/admin/usage-stats）の集計（純粋関数・2026年10月22日に page.tsx から切り出し）。
 *
 * 🔴 「今月」は【JST の今月 1 日 0:00 から】、「前月」は【JST の前月 1 日 0:00 から】数える。
 * 以前は page.tsx が jstMonthStartIso(-1)（＝前月 1 日）を「今月」の起点にしていたため、
 * 「MAU（月間）」と「今月の予約ステータス」に前月分がまるごと混ざり（10/22 なら 9/1〜10/22 の
 * 約 52 日分）、「前月比」は約 52 日分と前々月 1 か月分を比べていた。同じ画面の
 * 「月別 MAU」の当月バー（こちらは正しく当月だけ）とも数が合わなかった。
 *
 * 前月との比較は【前月の同じ経過期間】と比べる（前月同期比）。10/22 12:00 なら
 * 10/1 0:00〜10/22 12:00 と 9/1 0:00〜9/22 12:00 を比べる。月の途中で前月 1 か月分と比べると、
 * 月初ほど必ず大きなマイナスに見えてしまうため。前月が短くて同じ日付が無いとき
 * （3/31 に 2 月と比べる等）は前月末で打ち切る＝前月まるごと。
 *
 * 期間の判定は文字列ではなく時刻（ミリ秒）で比べる。PostgREST の created_at は
 * `2026-10-01T00:00:00+00:00` 形式で、toISOString() の `...000Z` と文字列比較すると
 * ちょうど境界の時刻が前の期間に落ちるため。
 */

export type UsageBooking = {
  user_id: string | null;
  created_at: string | null;
  status: string;
};

export type UsageStats = {
  /** 今日（JST）予約したユニーク利用者数 */
  dau: number;
  /** 過去 7 日間（JST の 7 日前 0:00 から） */
  wau: number;
  /** 今月（JST の今月 1 日 0:00 から今まで）のユニーク利用者数 */
  mau: number;
  /** 前月の同じ経過期間のユニーク利用者数 */
  prevMauSamePeriod: number;
  /** 前月同期比（%）。前月同期が 0 人なら比べられないので null */
  mauGrowth: number | null;
  repeatUsers: number;
  totalUsers: number;
  repeatRate: number;
  /** 直近 6 か月（古い順・最後が今月） */
  monthly: { month: string; mau: number; bookings: number }[];
  /** 今月（JST）に作られた予約のステータス別件数 */
  statusCount: Record<string, number>;
};

export function computeUsageStats(bookings: UsageBooking[]): UsageStats {
  const at = (iso: string) => Date.parse(iso);
  const nowMs = Date.now(); // admin-date の境界と同じ「今」（同じ時計）を使う
  const today = at(jstDayStartIso(0));
  const weekAgo = at(jstDayStartIso(-7));
  const monthStart = at(jstMonthStartIso(0));
  const prevMonthStart = at(jstMonthStartIso(-1));
  const prevSamePeriodEnd = Math.min(prevMonthStart + (nowMs - monthStart), monthStart);

  // 🔴 bookings.user_id / created_at はどちらも nullable。
  // user_id: 退会したユーザーの予約は ON DELETE SET NULL で null になり、ゲスト予約・店舗の手入力予約も
  // null。これを数えると全部が 1 人の「null ユーザー」に集約され、DAU/WAU/MAU が最大 1 人分多く出て、
  // リピート率は「全部を 1 人が繰り返した」と誤って数える。利用者数は識別できる予約だけで数える。
  // created_at: null や解釈できない値はどの期間にも帰属させられないので除く。
  const dated = bookings
    .map((b) => ({ ...b, t: b.created_at === null ? Number.NaN : at(b.created_at) }))
    .filter((b) => !Number.isNaN(b.t));
  const users = (from: number, to = Number.POSITIVE_INFINITY) => new Set(
    dated.filter((b) => b.user_id !== null && b.t >= from && b.t < to).map((b) => b.user_id),
  ).size;

  const mau = users(monthStart);
  const prevMauSamePeriod = users(prevMonthStart, prevSamePeriodEnd);
  const mauGrowth = prevMauSamePeriod > 0
    ? Math.round(((mau - prevMauSamePeriod) / prevMauSamePeriod) * 100)
    : null;

  // リピート率（識別できる利用者のみ。退会者・ゲストは「同一人物かどうか」を判定できない）
  const userBookingCount = new Map<string, number>();
  for (const b of dated) {
    if (b.user_id !== null) userBookingCount.set(b.user_id, (userBookingCount.get(b.user_id) ?? 0) + 1);
  }
  const totalUsers = userBookingCount.size;
  const repeatUsers = [...userBookingCount.values()].filter((c) => c > 1).length;
  const repeatRate = totalUsers > 0 ? Math.round((repeatUsers / totalUsers) * 100) : 0;

  // 月別（直近 6 か月）。MAU は識別できる利用者数、件数は全件で数える。
  const monthly: UsageStats['monthly'] = [];
  for (let i = 5; i >= 0; i--) {
    const start = at(jstMonthStartIso(-i));
    const end = at(jstMonthStartIso(-i + 1));
    monthly.push({
      month: `${jstMonthInfo(-i).month}月`,
      mau: users(start, end),
      bookings: dated.filter((b) => b.t >= start && b.t < end).length,
    });
  }

  const statusCount: Record<string, number> = {};
  for (const b of dated) {
    if (b.t >= monthStart) statusCount[b.status] = (statusCount[b.status] ?? 0) + 1;
  }

  return {
    dau: users(today),
    wau: users(weekAgo),
    mau,
    prevMauSamePeriod,
    mauGrowth,
    repeatUsers,
    totalUsers,
    repeatRate,
    monthly,
    statusCount,
  };
}
