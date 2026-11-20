import { z } from 'zod';
import { lineSupportRpc, supportDeliverySchema,supportDeliveryContextSchema } from './line-support-store';
import { lineSupportKnowledge } from './line-support-knowledge';
import { decideLineSupport,type SupportInput } from './line-support-policy';
import { hasLineSupportQuota } from './line-support-quota';

export async function dispatchLineSupportDelivery(id: string): Promise<'accepted' | 'unknown' | 'failed' | 'not_attempted'> {
  if(process.env.LINE_SUPPORT_ENABLED!=='true')return 'not_attempted';
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  if (!token) return 'not_attempted';
  const knowledge = lineSupportKnowledge(process.env.VERCEL_GIT_COMMIT_SHA ?? null);
  if (!knowledge.deployment || !/^[a-f0-9]{40}$/.test(knowledge.deployment)) return 'not_attempted';
  const context=await lineSupportRpc('line_support_delivery_context',{p_delivery_id:id},supportDeliveryContextSchema);
  if(!context)return 'not_attempted';
  let expected:string|null=null;
  if(context.kind==='operator_draft'){
    if(!await hasLineSupportQuota(token))return 'not_attempted';
  }else{
    // Revalidate the original question with the current policy, not a queued classifier result.
    const decision=decideLineSupport({type:context.message_type as SupportInput['type'],source:'user',text:context.question??''},context.mode,knowledge);
    if(decision.action==='reply')expected=decision.text;
  }
  const delivery = await lineSupportRpc('claim_line_support_delivery', { p_delivery_id: id, p_knowledge_revision: knowledge.revision,p_expected_reply:expected }, supportDeliverySchema);
  if (!delivery) return 'not_attempted';
  const reply=delivery.kind==='customer_reply';
  let outcome: 'accepted' | 'unknown' | 'failed' = 'unknown';
  let requestId: string | null = null;
  const expiry=Date.parse(delivery.reply_expires_at??'');
  if(reply&&(!delivery.reply_token||!Number.isFinite(expiry)||expiry<=Date.now()+1000))outcome='failed';
  else try {
    // The operator receives only the copyable proposal; case details stay in the admin console (delivery.body).
    const messages=!reply&&delivery.proposal_body?[{type:'text',text:delivery.proposal_body}]:[{type:'text',text:delivery.body}];
    const response = await fetch('https://api.line.me/v2/bot/message/'+(reply?'reply':'push'), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(!reply?{'X-Line-Retry-Key':delivery.retry_key}:{}) },
      body: JSON.stringify(reply?{replyToken:delivery.reply_token,messages}:{to:delivery.recipient_id,messages}),
      signal: AbortSignal.timeout(reply?5000:8000), redirect: 'manual',
    });
    requestId = response.status === 409 ? response.headers.get('x-line-accepted-request-id') : response.headers.get('x-line-request-id');
    if (response.ok || (!reply&&response.status === 409 && requestId)) outcome = 'accepted';
    else if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 409) outcome = 'failed';
  } catch { /* Never retry a possibly consumed reply token or invent a push retry key. */ }
  const confirmed = await lineSupportRpc('finish_line_support_delivery', { p_delivery_id: id, p_state: outcome, p_request_id: requestId }, z.boolean());
  if (!confirmed) throw new Error('LINE support delivery receipt unconfirmed');
  return outcome;
}
