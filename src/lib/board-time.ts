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
