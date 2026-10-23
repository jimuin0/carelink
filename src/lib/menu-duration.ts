import { z } from 'zod';
import { BOOKING_DURATION_MAX_MINUTES, BOOKING_DURATION_MIN_MINUTES } from './booking-slot-rules';

/**
 * 管理画面で保存するメニューの所要時間（分）の規則（2026年10月23日）。
 *
 * 予約枠（get_available_slots）が受け付ける所要時間は 15〜480 分で、/admin/menus の入力欄も同じ範囲しか
 * 受け付けない。ところが /api/admin/menus（作成・更新）は 0〜1440 分を通していたため、画面を経ない
 * リクエストで 0 分・1000 分のメニューが保存でき、予約画面では丸められた別の長さで枠を押さえていた。
 *
 * 範囲は予約枠の規則（booking-slot-rules.ts）と同じ数を使う。HPB 取り込み（/api/admin/hpb-menus/apply）は
 * この API を通らず、取り込み側の検証（src/lib/hpb-menu.ts）に従う。
 */
export const MENU_DURATION_ERROR =
  `所要時間は${BOOKING_DURATION_MIN_MINUTES}〜${BOOKING_DURATION_MAX_MINUTES}分の整数で入力してください`;

export const menuDurationSchema = z.number().int().min(BOOKING_DURATION_MIN_MINUTES).max(BOOKING_DURATION_MAX_MINUTES);

/** 検証の失敗に所要時間の誤りが含まれるか（含まれれば、何を直せばよいかを 400 の文言で伝える）。 */
export function hasMenuDurationIssue(error: z.ZodError): boolean {
  return error.issues.some(issue => issue.path[0] === 'duration_minutes');
}
