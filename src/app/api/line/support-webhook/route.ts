import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyLineSignature } from '@/lib/line';
import { lineSupportRpc, supportOperationSchema } from '@/lib/line-support-store';
import { enqueueLineSupportEvents } from '@/lib/line-support-wakeup';
import { lineSupportKnowledge,publicLineSupportAnswer } from '@/lib/line-support-knowledge';
import { serverError } from '@/lib/with-route';
import type { Json } from '@/types/database.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const path = '/api/line/support-webhook';
const lineId = z.string().regex(/^U[0-9a-f]{32}$/);
const eventSchema = z.object({
  webhookEventId: z.string().min(1).max(128), timestamp: z.number().int().positive(),
  replyToken:z.string().min(1).max(2048).optional(),mode:z.string().optional(),
  type: z.string(), source: z.object({ type: z.string(), userId: lineId.optional() }),
  message: z.object({ id: z.string().min(1).max(128), type: z.string(), text: z.string().max(5000).optional() }).passthrough().optional(),
  unsend: z.object({ messageId: z.string().min(1).max(128) }).optional(),
});
const bodySchema = z.object({ destination: lineId, events: z.array(eventSchema).max(100) });
const supportedTypes = z.enum(['text','image','file','audio','video','sticker','location']);

/** A separate disabled-by-default receiver allows a reversible cutover from the old bot. */
export async function POST(request: Request) {
  if (process.env.LINE_SUPPORT_ENABLED !== 'true') return NextResponse.json({ error: 'Support receiver is not enabled' }, { status: 503 });
  const expected = process.env.LINE_SUPPORT_DESTINATION;
  if (!lineId.safeParse(expected).success) return serverError('line-support-config', new Error('Support destination is not configured'), path);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 2100000) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  try {
    const signature = request.headers.get('x-line-signature');
    if (!signature || !verifyLineSignature(raw, signature)) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  } catch { return serverError('line-support-signature', new Error('Support signature configuration unavailable'), path); }
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(decoded);
  if (!parsed.success || parsed.data.destination !== expected) return NextResponse.json({ error: 'Invalid support events' }, { status: 400 });
  if (parsed.data.events.some(event => event.timestamp > Date.now() + 300000)) return NextResponse.json({ error: 'Invalid event time' }, { status: 400 });
  const accepted: string[] = [];
  const inbox:(Record<string,Json>&{event_id:string})[]=[];
  const knowledge=lineSupportKnowledge(process.env.VERCEL_GIT_COMMIT_SHA ?? null);
  try {
    // One transaction preserves provider order and avoids 100 sequential network
    // round trips. Any failure rolls the batch back and LINE can safely redeliver.
    for (const event of parsed.data.events) {
      if (event.source.type !== 'user' || !event.source.userId || (event.mode!==undefined && event.mode!=='active')) continue;
      const text = event.message?.text;
      const pairing = event.type === 'message' && event.message?.type === 'text' && text?.match(/^CareLink連携 ([A-Za-z0-9_-]{32})$/);
      if (pairing) {
        const hash = createHash('sha256').update(pairing[1]).digest('hex');
        await lineSupportRpc('confirm_line_support_pair_candidate', { p_hash: hash, p_line_user_id: event.source.userId }, z.boolean());
        continue;
      }
      const kind = event.type === 'unfollow' || event.type === 'unsend' || event.type === 'follow' ? event.type : supportedTypes.safeParse(event.message?.type).data;
      if (!kind || !['message','unfollow','unsend','follow'].includes(event.type)) continue;
      inbox.push({
        event_id: event.webhookEventId, line_user_id: event.source.userId, message_type: kind,
        message_id: event.unsend?.messageId ?? event.message?.id ?? null,
        body: kind === 'text' ? text ?? '' : `[${kind}]`, occurred_at: new Date(event.timestamp).toISOString(),
        requires_human:kind!=='text'||Date.now()-event.timestamp>300000||!publicLineSupportAnswer(text??'',knowledge),
        raw_message:(event.message??{}) as Json,
        reply_token:event.replyToken??null,
      });
    }
    if(inbox.length){
      const results=await lineSupportRpc('accept_line_support_events',{p_events:inbox},z.array(supportOperationSchema.extend({status:z.enum(['accepted','duplicate','disabled']),event_id:z.string().min(1).max(128)})).max(100));
      if(results.length!==inbox.length||results.some((result,index)=>result.event_id!==inbox[index].event_id))throw new Error('Incomplete support batch receipt');
      for(const result of results)if(result.status==='accepted'||result.status==='duplicate')accepted.push(result.event_id);
    }
    // Never acknowledge until both durable storage and durable wake-up succeed.
    // A queue failure returns 5xx; LINE redelivery re-enqueues the existing IDs.
    await enqueueLineSupportEvents([...new Set(accepted)]);
    return NextResponse.json({ status: 'accepted', events: accepted.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return serverError('line-support-acceptance', new Error('Support acceptance could not be confirmed'), path); }
}
