/**
 * 予約画面のテスト用：/api/slots/week の応答を組み立てる。
 * 画面は 1 週（スタッフ×最大7日）を 1 回で取得するので、リクエスト URL の staffIds と dates から
 * 「全スタッフ×全日付に同じ空き枠を返す」応答を作る（テストごとに空き枠の中身だけ差し替える）。
 */
export type SlotLike = { slot_start: string; slot_end: string; staff_id?: string };

export function slotsWeekBody(url: string, slots: SlotLike[] | ((staffId: string, date: string) => SlotLike[])) {
  const params = new URL(url, 'http://localhost').searchParams;
  const staffIds = (params.get('staffIds') ?? '').split(',').filter(Boolean);
  const dates = (params.get('dates') ?? '').split(',').filter(Boolean);
  const days: Record<string, Record<string, SlotLike[]>> = {};
  for (const date of dates) {
    days[date] = {};
    for (const staffId of staffIds) days[date][staffId] = typeof slots === 'function' ? slots(staffId, date) : slots;
  }
  return { days };
}

/** fetch のモック実装：/api/slots/week には上の応答を、それ以外には空の 200 を返す。 */
export function slotsWeekFetch(slots: SlotLike[] | ((staffId: string, date: string) => SlotLike[])) {
  return (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/slots/week') ? slotsWeekBody(url, slots) : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  };
}

/** 呼ばれた /api/slots/week のスタッフ ID をすべて返す（担当スタッフの絞り込み検証用）。 */
export function requestedStaffIds(calls: unknown[][]): string[] {
  return calls.map(c => String(c[0])).filter(u => u.includes('/api/slots/week'))
    .flatMap(u => (new URL(u, 'http://localhost').searchParams.get('staffIds') ?? '').split(',').filter(Boolean));
}
