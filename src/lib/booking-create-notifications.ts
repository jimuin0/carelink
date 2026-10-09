import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingFormData } from './validations-booking';
import { buildBookingConfirmationEnvelope, buildBookingConfirmedEnvelope, buildNewBookingNotificationEnvelope } from './email';
import { isLineWorksConfigured, prepareNewBookingLineWorksDelivery } from './integrations/line-works';
import { sendLinePushWithOutcome } from './line';
import { sendPushToUser } from './push';
import { fetchAllPaged } from './paginate';
import { z } from 'zod';

export type BookingCreateNotification = {
  kind: 'email' | 'push' | 'line' | 'line_works'; role: 'customer' | 'owner' | 'staff'; target: string;
  context?: {owner_ids:string[];owner_push:boolean;works_enabled:boolean;line_enabled:boolean}; snapshot?: Record<string,string|number|null>; user_id?: string; envelope?: { from: string; to: string; subject: string; html: string }; payload?: Record<string, string>;
};

export class BookingNotificationPlanError extends Error {
  constructor() { super('BOOKING_NOTIFICATION_PLAN_UNAVAILABLE'); }
}
const memberSchema=z.object({user_id:z.string().min(1)});
const profileSchema=z.object({id:z.string().min(1),email:z.email().nullable()});
const worksRowSchema=z.object({id:z.string().min(1),line_works_channel_id:z.string().nullable(),line_works_notify_all:z.boolean().nullable().optional()});
async function collection<T>(page:(offset:number,limit:number)=>PromiseLike<{data:unknown;error:unknown}>,schema:z.ZodType<T>):Promise<T[]> {
  const result=await fetchAllPaged<T>(async(offset,limit)=>{
    const response=await page(offset,limit);
    if(response.error || !Array.isArray(response.data))throw new BookingNotificationPlanError();
    const rows=z.array(schema).safeParse(response.data);if(!rows.success)throw new BookingNotificationPlanError();
    return {data:rows.data,error:null};
  },{pageSize:100,maxRows:1000,failOnTruncation:true});
  if(result.error)throw new BookingNotificationPlanError();return result.rows;
}

/** Build the complete plan before acceptance. A failed lookup never silently drops a recipient. */
export async function buildBookingCreateNotifications(db: SupabaseClient, input: BookingFormData, actor: string | null,
  primaryMenu: string, totalPrice: number, status: string): Promise<BookingCreateNotification[]> {
  const [facility, menu, staff, members, flags, line, works] = await Promise.all([
    db.from('facility_profiles').select('name').eq('id', input.facility_id).single(),
    db.from('facility_menus').select('name').eq('id', primaryMenu).eq('facility_id', input.facility_id).single(),
    input.staff_id ? db.from('staff_profiles').select('name').eq('id', input.staff_id).eq('facility_id', input.facility_id).single() : Promise.resolve({ data: null, error: null }),
    collection((offset,limit)=>db.from('facility_members').select('user_id').eq('facility_id', input.facility_id).in('role', ['owner', 'admin']).order('user_id').range(offset,offset+limit-1),memberSchema).then(data=>({data,error:null})),
    db.from('facility_notification_settings').select('push_on_new_booking').eq('facility_id', input.facility_id).maybeSingle(),
    actor && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK ? db.from('profiles').select('line_user_id').eq('id', actor).maybeSingle() : Promise.resolve({ data: null, error: null }),
    isLineWorksConfigured() ? collection((offset,limit)=>db.from('staff_profiles').select('id,line_works_channel_id,line_works_notify_all').eq('facility_id', input.facility_id).not('line_works_channel_id', 'is', null).order('id').range(offset,offset+limit-1),worksRowSchema).then(data=>({data,error:null})) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([facility, menu, staff, members, flags, line, works].some(r => r.error) || !facility.data || !menu.data) throw new BookingNotificationPlanError();
  const ids = [...new Set(members.data.map(m => m.user_id))];
  if(ids.length>250)throw new BookingNotificationPlanError();
  const profiles = ids.length ? {data:await collection((offset,limit)=>db.from('profiles').select('id,email').in('id',ids).order('id').range(offset,offset+limit-1),profileSchema),error:null} : { data: [], error: null };
  if (profiles.data.length !== ids.length) throw new BookingNotificationPlanError();
  const data = { customerName: input.customer_name, customerEmail: input.email, facilityName: facility.data.name,
    menuName: menu.data.name, staffName: staff.data?.name, bookingDate: input.booking_date, startTime: input.start_time,
    endTime: input.end_time, totalPrice, bookingId: '', bookingStatus:status };
  const plan: BookingCreateNotification[] = [{ kind: 'email', role: 'customer', target: input.email,
    envelope: status === 'confirmed' ? buildBookingConfirmedEnvelope(data) : buildBookingConfirmationEnvelope(data) }];
  const ownerEmails = new Set<string>();
  for (const profile of profiles.data!) {
    if (profile.email && !ownerEmails.has(profile.email)) {
      ownerEmails.add(profile.email);
      plan.push({ kind: 'email', role: 'owner', user_id: profile.id, target: profile.email,
        envelope: buildNewBookingNotificationEnvelope({ ...data, facilityEmail: profile.email }) });
    }
    if (flags.data?.push_on_new_booking !== false) plan.push({ kind: 'push', role: 'owner', user_id: profile.id, target: profile.id,
      payload: { title: '新規予約', body: `${input.customer_name}様から${input.booking_date} ${input.start_time}〜の予約が入りました`, url: '/admin/bookings' } });
  }
  if (actor) plan.push({ kind: 'push', role: 'customer', target: actor,
    payload: { title: '予約を受け付けました', body: `${input.booking_date} ${input.start_time}〜のご予約を承りました`, url: '/mypage' } });
  const lineLink = line.data?.line_user_id && actor ? await db.from('line_user_links').select('user_id,proof_version,verified_at').eq('line_user_id',line.data.line_user_id).eq('user_id',actor).maybeSingle() : { data:null,error:null };
  if (lineLink.error) throw new BookingNotificationPlanError();
  if (lineLink.data?.user_id === actor && lineLink.data.proof_version === 1
    && typeof lineLink.data.verified_at === 'string' && Number.isFinite(Date.parse(lineLink.data.verified_at)) && line.data?.line_user_id) plan.push({ kind: 'line', role: 'customer', target: line.data.line_user_id,
    payload: { message: `✅ 予約を受け付けました\n\n📍 ${data.facilityName}\n📋 ${data.menuName}\n📅 ${input.booking_date} ${input.start_time}${data.staffName ? `\n担当: ${data.staffName}` : ''}\n\nご来店をお待ちしております。` } });
  const channels = new Set<string>();
  for (const row of works.data) if (row.line_works_channel_id && (row.id === input.staff_id || row.line_works_notify_all) && !channels.has(row.line_works_channel_id)) {
    channels.add(row.line_works_channel_id);
    plan.push({ kind: 'line_works', role: 'staff', target: row.line_works_channel_id,
      payload: { customerName: input.customer_name, menuName: data.menuName, bookingDate: input.booking_date, startTime: input.start_time,
        ...(data.staffName ? { staffName: data.staffName } : {}) } });
  }
  const snapshot = { customer_name:input.customer_name,email:input.email,facility_name:data.facilityName,menu_name:data.menuName,
    staff_name:data.staffName ?? null,booking_date:input.booking_date,start_time:input.start_time,end_time:input.end_time,total_price:totalPrice,status };
  if(plan.length>250)throw new BookingNotificationPlanError();
  plan[0].context={owner_ids:ids,owner_push:flags.data?.push_on_new_booking !== false,works_enabled:isLineWorksConfigured(),line_enabled:!!actor && !!process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK};
  return plan.map(item => ({ ...item, snapshot }));
}

const pushSchema = z.object({ title: z.string().min(1), body: z.string().min(1), url: z.string().optional(), tag: z.string().optional() });
const worksSchema = z.object({ customerName: z.string(), menuName: z.string(), bookingDate: z.string(), startTime: z.string(), staffName: z.string().optional() });
/** Preparation runs before the persistent send fence. False/unknown provider outcomes cannot be retried automatically. */
export async function prepareBookingCreationChannel(job: { webhook_type: string; target_id: string; payload: unknown }): Promise<() => Promise<void>> {
  if (job.webhook_type === 'booking_creation_push') {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('booking push not configured');
    const payload = pushSchema.parse(job.payload);
    return async () => { if (!await sendPushToUser(job.target_id, payload)) throw new Error('booking push acceptance not confirmed'); };
  }
  if (job.webhook_type !== 'booking_creation_lineworks' || !isLineWorksConfigured()) throw new Error('booking LINE Works not configured');
  const payload = worksSchema.parse(job.payload);
  const send = await prepareNewBookingLineWorksDelivery(job.target_id, payload);
  return async () => { if (!await send()) throw new Error('booking LINE Works acceptance not confirmed'); };
}

export async function sendBookingCreationLine(target: string, message: string): Promise<boolean> {
  return await sendLinePushWithOutcome(target,[{type:'text',text:message}],1) === 'delivered';
}
