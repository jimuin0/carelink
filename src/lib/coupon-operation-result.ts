import { UUID_REGEX } from './constants';
import type { Json } from '@/types/database.types';
export function couponOperationResult(data: Json) {
  if(!data || typeof data!=='object' || Array.isArray(data) || typeof data.was_replay!=='boolean'
    || !['saved','deleted','deactivated'].includes(data.outcome as string))throw new Error('COUPON_OPERATION_RECEIPT_INVALID');
  return data as Record<string,Json> & {was_replay:boolean;outcome:'saved'|'deleted'|'deactivated'};
}
export function couponSavedResult(data: Json,facilityId:string,expectedId?:string) {
  const result=couponOperationResult(data);
  const row=result.coupon;
  if(result.outcome!=='saved' || !row || typeof row!=='object' || Array.isArray(row)
    || typeof row.id!=='string' || !UUID_REGEX.test(row.id) || row.facility_id!==facilityId
    || (expectedId!==undefined && row.id!==expectedId.toLowerCase()))throw new Error('COUPON_SAVE_RECEIPT_INVALID');
  return {coupon:row as Record<string,Json> & {id:string},wasReplay:result.was_replay};
}
