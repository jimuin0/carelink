import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { databaseDiagnostic } from './database-diagnostic';
import { serverError } from './with-route';
import { UUID_REGEX } from './constants';
import type { Json } from '@/types/database.types';
const receipt=z.object({id:z.string().regex(UUID_REGEX),facility_id:z.string().regex(UUID_REGEX)}).passthrough();
export async function saveAdminFacilityIntegration(input:{actorId:string;facilityId:string;kind:'gbp:connect'|'gbp:refresh'|'domain:configure'|'domain:verify';expected:Json;values:Json}) {
 const tag='admin-integration-'+input.kind;let result;
 try {result=await createServiceRoleClient().rpc('save_admin_facility_integration_atomic',{p_actor_id:input.actorId,p_facility_id:input.facilityId,p_kind:input.kind,p_expected:input.expected,p_values:input.values});}
 catch(error){return serverError(tag,databaseDiagnostic(error),'/api/admin');}
 if(result.error){
  if(result.error.code==='42501')return NextResponse.json({error:'Forbidden'},{status:403});
  if(result.error.code==='P0002')return NextResponse.json({error:'Not found'},{status:404});
  if(result.error.code==='40001'||result.error.code==='23505')return NextResponse.json({error:'設定が変更されました。再読み込みしてください'},{status:409});
  if(result.error.code==='22023')return NextResponse.json({error:'Invalid request'},{status:400});
  return serverError(tag,databaseDiagnostic(result.error),'/api/admin');
 }
 const parsed=receipt.safeParse(result.data);
 if(!parsed.success||parsed.data.facility_id!==input.facilityId.toLowerCase()||(input.kind.startsWith('gbp:')&&parsed.data.id!==input.facilityId.toLowerCase()))return serverError(tag+'-receipt',new Error('INTEGRATION_RESULT_INVALID'),'/api/admin');
 if(input.kind.startsWith('domain:')){
  const domain=z.object({domain:z.string()}).safeParse(input.kind==='domain:configure'?input.values:input.expected);
  if(!domain.success||parsed.data.domain!==domain.data.domain||parsed.data.is_verified!==(input.kind==='domain:verify'))return serverError(tag+'-receipt',new Error('DOMAIN_RESULT_INVALID'),'/api/admin');
 }
 return parsed.data;
}
