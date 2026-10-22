import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isExpiredPushStatus, prepareCapturedPushDelivery, removeExpiredPushSubscription } from './push';
import { prepareSingleLineDelivery } from './line';
import { prepareSingleLineWorksDelivery } from './integrations/line-works';
import type { ChannelDeliveryResult } from './channel-delivery-result';

const subscriptionSchema = z.object({ endpoint: z.url().max(4096).refine(s => s.startsWith('https://')),
  p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }).strict();
const payloadSchema = z.object({
  customer_booking_channel_version: z.literal(1), operationId: z.uuid(), eventId: z.uuid(), kind: z.enum(['cancelled','rescheduled']),
  role: z.enum(['customer','owner','staff']), recipientUserId: z.uuid().nullable(), recipientStaffIds: z.array(z.uuid()).max(500),
  subscriptionProof: z.string().regex(/^[a-f0-9]{64}$/).nullable(), pushSubscription: subscriptionSchema.nullable(),
  lineProof: z.iso.datetime({ offset: true }).nullable(),
  snapshot: z.object({ bookingId: z.uuid(), bookingRevision: z.iso.datetime({ offset: true }), actorUserId: z.uuid(),
    customerName: z.string().max(500), facilityName: z.string().max(500), menuName: z.string().max(500),
    bookingDate: z.iso.date(), startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  }).strict(),
}).strict();
const jobSchema = z.object({ id: z.uuid(), webhook_type: z.enum(['customer_booking_push','customer_booking_line','customer_booking_lineworks']),
  target_id: z.string().min(1).max(512), payload: payloadSchema,
}).superRefine((j,ctx) => {
  const p=j.payload;
  const invalid=()=>ctx.addIssue({code:'custom',message:'BOOKING_CHANNEL_SCOPE_INVALID'});
  if (p.operationId !== j.id || (p.role==='customer' && p.recipientUserId !== p.snapshot.actorUserId)) invalid();
  if (j.webhook_type==='customer_booking_push') {
    if (!z.uuid().safeParse(j.target_id).success || !p.recipientUserId || !p.pushSubscription || !p.subscriptionProof
      || p.role==='staff' || (p.role==='customer' && p.kind!=='rescheduled') || p.recipientStaffIds.length || p.lineProof) invalid();
  } else if (j.webhook_type==='customer_booking_line') {
    if (p.kind!=='cancelled' || p.role!=='customer' || !p.recipientUserId || !p.lineProof
      || p.pushSubscription || p.subscriptionProof || p.recipientStaffIds.length) invalid();
  } else if (p.role!=='staff' || !p.recipientStaffIds.length || p.recipientUserId || p.pushSubscription || p.subscriptionProof || p.lineProof) invalid();
});

/** Validate and freeze provider preparation before marking delivery started.
 * No source/recipient reread reconstructs an older transition's content. */
export async function prepareCustomerBookingChannel(input: unknown): Promise<() => Promise<ChannelDeliveryResult>> {
  const job=jobSchema.parse(input),p=job.payload,s=p.snapshot;
  if (job.webhook_type==='customer_booking_push') {
    const subscription=p.pushSubscription!;
    const proof=createHash('sha256').update([subscription.endpoint,subscription.p256dh,subscription.auth].join('\x1f')).digest('hex');
    if (proof!==p.subscriptionProof) throw new Error('BOOKING_CHANNEL_SUBSCRIPTION_INVALID');
    const payload=p.kind==='cancelled' ? { title:'予約がキャンセルされました',
      body:`${s.customerName}様 ${s.bookingDate} ${s.startTime.slice(0,5)}〜 の予約がキャンセルされました`, url:'/admin/bookings',tag:`cancel-${s.bookingId}` }
      : p.role==='customer' ? { title:'ご予約日時を変更しました',body:`${s.bookingDate} ${s.startTime.slice(0,5)}〜に変更しました`,
        url:`/mypage/bookings/${s.bookingId}`,tag:`booking-change-${s.bookingId}` }
      : { title:'予約日時変更',body:`${s.customerName}が${s.bookingDate} ${s.startTime.slice(0,5)}〜に変更しました`,url:'/admin/bookings',tag:`booking-change-owner-${s.bookingId}` };
    const send=prepareCapturedPushDelivery(subscription,payload);
    const recipient=p.recipientUserId!;
    return async () => {
      const result=await send();
      // 404/410＝端末の購読が失効している。この行を残すと、以後の予約通知が毎回同じ失効端末へ
      // 向かって失敗し続ける。消せば次の試行は開始時点で superseded として閉じる。
      if (result.outcome==='rejected' && isExpiredPushStatus(result.status)) await removeExpiredPushSubscription(recipient,subscription);
      return result;
    };
  }
  if (job.webhook_type==='customer_booking_line') {
    return prepareSingleLineDelivery(job.target_id,[ '❌ 予約キャンセル', '', `📍 ${s.facilityName}`,
      `📋 ${s.menuName}`, `📅 ${s.bookingDate} ${s.startTime.slice(0,5)}`, '', 'またのご来店をお待ちしております。' ].join('\n'));
  }
  const text=p.kind==='cancelled' ? [ '❌ 予約キャンセル', '', `お客様: ${s.customerName}`, `メニュー: ${s.menuName}`,
    `日時: ${s.bookingDate} ${s.startTime.slice(0,5)}`, '', '枠が空きになりました' ].join('\n')
    : [ '🔄 予約変更', '', `お客様: ${s.customerName}`, s.menuName ? `メニュー: ${s.menuName}` : '',
      `変更後日時: ${s.bookingDate} ${s.startTime.slice(0,5)}` ].filter(Boolean).join('\n');
  return await prepareSingleLineWorksDelivery(job.target_id,text);
}
