import { beginStaffOperation, finishStaffOperation, pendingStaffOperation } from './staff-operation';

export type CouponOperationKind = 'create' | 'update' | 'retire';
export function couponOperationKey(actor: string, facility: string, kind: CouponOperationKind, coupon = 'new') {
  return `carelink-coupon-operation:${actor}:${facility}:${kind}:${coupon}`;
}
// Reuse the existing durable UUID/storage validation. No form values are stored.
export const beginCouponOperation = beginStaffOperation;
export const finishCouponOperation = finishStaffOperation;
export async function recoverCouponOperation(key: string, facility: string, kind: CouponOperationKind, coupon?: string): Promise<'absent' | 'saved' | 'retired'> {
  const operation = pendingStaffOperation(key);
  if (operation === null) return 'absent';
  const query = new URLSearchParams({facility_id:facility,operation_id:operation,kind});
  if(coupon !== undefined)query.set('coupon_id',coupon);
  const response = await fetch(`/api/admin/coupons?${query.toString()}`,{cache:'no-store'});
  if(!response.ok)throw new Error('Coupon operation recovery unavailable');
  const data=await response.json();
  if(!['absent','saved','retired'].includes(data?.state))throw new Error('Invalid coupon operation recovery');
  // An absent receipt can still be followed by a delayed original HTTP request.
  // Keep that same UUID until a saved/retired result is confirmed.
  if(data.state!=='absent')finishCouponOperation(key);
  return data.state;
}
