/**
 * 施設ごとの PAY.JP customer を用意する（広告枠・有料オプションの月額で共用・2026年11月14日）。
 *
 * 既に customer があればカードを差し替えて既定にし、無ければ作って facility_payjp_customers に保存する。
 * カード番号はサーバーを通らない（payjp.js のトークン tok_... だけを受け取る）。
 *
 * 戻り値：
 *   - { ok: true, customerId }
 *   - { ok: false, reason: 'card' }  … カードが使えなかった（利用者に直してもらう・400）
 *   - { ok: false, reason: 'error', tag, error } … DB・PAY.JP の障害（500＋通知）
 */
import type { createServiceRoleClient } from './supabase-server';
import { addDefaultCard, createCustomer, isCardError } from './payjp';

type Admin = ReturnType<typeof createServiceRoleClient>;

export type EnsureCustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: 'card' }
  | { ok: false; reason: 'error'; tag: 'customer-read' | 'customer-save' | 'customer'; error: unknown };

export const CARD_REJECTED_MESSAGE = 'カードを利用できませんでした。カード情報を確かめるか、別のカードでお試しください。';
export const PAYJP_UNAVAILABLE_MESSAGE = '決済サービスに接続できませんでした。時間をおいて再度お試しください。';

export async function ensureFacilityCustomer(admin: Admin, facilityId: string, token: string): Promise<EnsureCustomerResult> {
  const { data: row, error: readErr } = await admin
    .from('facility_payjp_customers').select('payjp_customer_id').eq('facility_id', facilityId).maybeSingle();
  if (readErr) return { ok: false, reason: 'error', tag: 'customer-read', error: readErr };
  try {
    if (row?.payjp_customer_id) {
      await addDefaultCard(row.payjp_customer_id, token);
      return { ok: true, customerId: row.payjp_customer_id };
    }
    const customerId = (await createCustomer(token, facilityId)).id;
    const { error: saveErr } = await admin.from('facility_payjp_customers').insert({ facility_id: facilityId, payjp_customer_id: customerId });
    if (saveErr) {
      return { ok: false, reason: 'error', tag: 'customer-save', error: new Error(`${saveErr.message} (orphan PAY.JP customer ${customerId})`) };
    }
    return { ok: true, customerId };
  } catch (err) {
    if (isCardError(err)) return { ok: false, reason: 'card' };
    return { ok: false, reason: 'error', tag: 'customer', error: err };
  }
}
