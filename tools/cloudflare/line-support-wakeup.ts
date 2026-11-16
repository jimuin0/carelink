import { env } from 'cloudflare:workers';

type QueueBinding={sendBatch(messages:{body:{eventId:string};contentType:'json'}[]):Promise<void>};
export function isLineSupportQueueConfigured():boolean {
  return typeof (env as unknown as {LINE_SUPPORT_QUEUE?:QueueBinding}).LINE_SUPPORT_QUEUE?.sendBatch === 'function';
}

/** Only opaque event IDs enter the external queue; all private content stays in the DB. */
export async function enqueueLineSupportEvents(ids:string[]):Promise<void>{
  if(ids.length===0)return;
  const binding=(env as unknown as {LINE_SUPPORT_QUEUE?:QueueBinding}).LINE_SUPPORT_QUEUE;
  if(!binding)throw new Error('Durable LINE support queue is not configured');
  await binding.sendBatch(ids.map(eventId=>({body:{eventId},contentType:'json'})));
}
