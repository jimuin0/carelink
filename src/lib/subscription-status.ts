// サブスク契約ステータスの単一の真実（SSOT）。予約の booking-status.ts と同型。
// オーナーが手動で行える状態遷移をここで明示し、route とUI が共有することで、
// 「到達不可能な遷移ボタン」や「UIに無いがAPIは無条件許可」というドリフトを構造的に防ぐ。

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired';

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: '契約中',
  paused: '一時停止',
  cancelled: '解約',
  expired: '期限切れ',
};

// Record<SubscriptionStatus,...> でコンパイラに全値の網羅を強制する。
export const SUBSCRIPTION_STATUSES = Object.keys(SUBSCRIPTION_STATUS_LABEL) as SubscriptionStatus[];

// オーナーが手動で行える許可遷移の SSOT。
// - active   → 一時停止 / 解約
// - paused   → 再開（active）/ 解約
// - cancelled→ 復活（active）。誤って解約した契約を元に戻す（神原さん確定で許可）。
// - expired  → 手動遷移なし。期限切れは ends_at 由来のシステム状態で、復活には期限の延長が必要。
export const ALLOWED_SUBSCRIPTION_STATUS_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  active: ['paused', 'cancelled'],
  paused: ['active', 'cancelled'],
  cancelled: ['active'],
  expired: [],
};

export function getAllowedSubscriptionStatusTransitions(current: SubscriptionStatus): SubscriptionStatus[] {
  return ALLOWED_SUBSCRIPTION_STATUS_TRANSITIONS[current] ?? [];
}

export function isAllowedSubscriptionStatusTransition(
  current: SubscriptionStatus,
  next: SubscriptionStatus,
): boolean {
  return getAllowedSubscriptionStatusTransitions(current).includes(next);
}
