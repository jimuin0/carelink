/**
 * サロンボードの時刻計算（純粋関数・テスト可能）。
 *
 * 背景: 旧実装は時刻変換をコンポーネント内に直書きしており、終了時刻が 24:00 以上に
 * なるケース（営業終盤＋長メニュー）を境界テストできず、API の time 正規表現
 * （00:00〜23:59）で 400 になる潜在バグがあった。純粋関数として抽出し境界を網羅検証する。
 */

/** "HH:MM" → 0時起点の分。不正トークンは 0 扱い（NaN を出さない）。 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 分 → "HH:MM"（24:00 以上も素直に表現する。営業時間超の判定は endExceedsClose で行う）。 */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 分を slotMin（既定30分）グリッドに切り捨てスナップ。 */
export function snapToSlot(min: number, slotMin = 30): number {
  return Math.floor(min / slotMin) * slotMin;
}

/** 開始分＋施術合計（最低 minDuration 分）から終了分を算出。 */
export function computeEndMinutes(startMin: number, durationMin: number, minDuration = 30): number {
  return startMin + Math.max(durationMin, minDuration);
}

/** 終了分が営業終了時刻（closeHour）を超えるか。24:00 跨ぎもこれで弾ける。 */
export function endExceedsClose(endMin: number, closeHour: number): boolean {
  return endMin > closeHour * 60;
}

/**
 * サロンボードの表示時間帯（時・整数グリッド）を算出する。
 *
 * - その日の営業時間（business_hours の当該曜日 open/close）が設定されていれば、それを
 *   時グリッドへ丸めて基準にする（open は切り捨て・close は切り上げ）。未設定・休業日
 *   （null）・open>=close の不正値は既定（defaultOpenHour〜defaultCloseHour）にフォールバック。
 * - 営業時間外に予約がある場合でもチップが切れて隠れないよう、最早予約開始・最遅予約終了で
 *   範囲を前後に自動拡張する（予約の無音消失を防ぐ）。
 * - 0〜24 にクランプし、最低1時間幅を保証する（open<close を必ず満たす）。
 *
 * これにより店舗は「設定→営業時間」を変えるだけでボード表示帯を変更できる（固定値を撤廃）。
 */
export function computeBoardHourRange(
  dayBusiness: { open?: string | null; close?: string | null } | null | undefined,
  bookings: { start_time: string; end_time: string }[],
  defaultOpenHour: number,
  defaultCloseHour: number,
): { openHour: number; closeHour: number } {
  let openHour = defaultOpenHour;
  let closeHour = defaultCloseHour;

  if (dayBusiness && dayBusiness.open && dayBusiness.close) {
    const o = timeToMinutes(dayBusiness.open);
    const c = timeToMinutes(dayBusiness.close);
    if (c > o) {
      openHour = Math.floor(o / 60);
      closeHour = Math.ceil(c / 60);
    }
  }

  for (const b of bookings) {
    openHour = Math.min(openHour, Math.floor(timeToMinutes(b.start_time) / 60));
    closeHour = Math.max(closeHour, Math.ceil(timeToMinutes(b.end_time) / 60));
  }

  openHour = Math.max(0, Math.min(openHour, 23));
  closeHour = Math.min(24, Math.max(closeHour, openHour + 1));
  return { openHour, closeHour };
}

/**
 * 時間が重複する区間を「レーン（段）」に貪欲割当する（ガントの重なり可視化用）。
 * 同一スタッフ・同時間帯の予約を縦に並置し、下のチップが隠れる問題を解消する。
 * 返り値: 各区間（入力順）のレーン番号配列と、総レーン数（最低1）。
 */
export function assignLanes(intervals: { start: number; end: number }[]): { lanes: number[]; laneCount: number } {
  const order = intervals
    .map((iv, i) => ({ iv, i }))
    .sort((a, b) => a.iv.start - b.iv.start || a.iv.end - b.iv.end);
  const laneEnds: number[] = []; // 各レーンの現在の占有終了時刻
  const lanes = new Array<number>(intervals.length).fill(0);
  for (const { iv, i } of order) {
    let placed = false;
    for (let L = 0; L < laneEnds.length; L++) {
      if (iv.start >= laneEnds[L]) {
        lanes[i] = L;
        laneEnds[L] = iv.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes[i] = laneEnds.length;
      laneEnds.push(iv.end);
    }
  }
  return { lanes, laneCount: Math.max(laneEnds.length, 1) };
}
