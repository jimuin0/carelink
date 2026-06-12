/**
 * 監査ログヘルパー（v8.33）
 * 重要な操作（予約変更・施設設定・スタッフ操作等）をaudit_logsに記録する
 */

import { createServiceRoleClient } from './supabase-server';
import { getClientIp } from './client-ip';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'publish'
  | 'suspend'
  | 'verify'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'confirm'
  | 'export'
  | 'booking_adjust_request';

export interface AuditLogEntry {
  userId?: string | null;
  facilityId?: string | null;
  action: AuditAction;
  tableName: string;
  recordId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * 監査ログを記録する（fire-and-forget）
 * ログ失敗でも本体処理を止めない
 *
 * @example
 *   // 正しい使い方: void を付けて await しない（fire-and-forget）
 *   void writeAuditLog({ action: 'update', tableName: 'bookings', ... });
 *
 *   // 誤った使い方（呼び出し元がログ完了を待ってしまう）:
 *   // await writeAuditLog(...);  ← 不要な await
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('audit_logs').insert({
      user_id:     entry.userId ?? null,
      facility_id: entry.facilityId ?? null,
      action:      entry.action,
      table_name:  entry.tableName,
      record_id:   entry.recordId ?? null,
      old_values:  entry.oldValues ?? null,
      new_values:  entry.newValues ?? null,
      ip_address:  entry.ipAddress ?? null,
      user_agent:  entry.userAgent ?? null,
    });
  } catch {
    // 監査ログの失敗で本体処理を止めない
  }
}

/**
 * Request からIPアドレスとユーザーエージェントを取得
 */
export function getRequestContext(request: Request): { ip: string | null; ua: string | null } {
  return {
    // クライアント詐称可能な XFF 先頭値ではなく、信頼できるIP（x-real-ip 優先・XFF末尾）。
    ip: getClientIp(request),
    ua: request.headers.get('user-agent') ?? null,
  };
}

/**
 * 差分（変更されたフィールドのみ）を抽出
 */
export function diffValues(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>
): { old: Record<string, unknown>; new: Record<string, unknown> } {
  const changedKeys = Object.keys(newObj).filter(
    (k) => JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])
  );
  return {
    old: Object.fromEntries(changedKeys.map((k) => [k, oldObj[k]])),
    new: Object.fromEntries(changedKeys.map((k) => [k, newObj[k]])),
  };
}
