import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lineSupportRpc, supportLeaseSchema, supportOperationSchema,supportJobSchema } from './line-support-store';
import { decideLineSupport, formatLineSupportDraftNotice, formatLineSupportFallbackNotice, type SupportInput } from './line-support-policy';
import { lineSupportKnowledge,publicLineSupportAnswer } from './line-support-knowledge';
import { generateLineSupportDraft, supportHistorySchema } from './line-support-draft';
import { dispatchLineSupportDelivery } from './line-support-delivery';
import { postToSlack } from './slack';

export async function processLineSupportEvent(eventId: string): Promise<void> {
  if(process.env.LINE_SUPPORT_ENABLED!=='true')return;
  const leaseId = randomUUID();
  const lease = await lineSupportRpc('claim_line_support_event', { p_event_id: eventId, p_lease_id: leaseId }, supportLeaseSchema);
  if (!lease) return;
  const knowledge = lineSupportKnowledge(process.env.VERCEL_GIT_COMMIT_SHA ?? null);
  const event = lease.event;
  if (event.message_type === 'unfollow' || event.message_type === 'unsend' || event.message_type === 'follow') return;
  const decision = decideLineSupport({ type: event.message_type as SupportInput['type'], source: 'user', text: event.body }, lease.mode, knowledge);
  let body: string;
  let model: string;
  let kind: 'customer_reply' | 'operator_draft';
  let proposal:string|null=null;
  const verified=event.message_type==='text'?publicLineSupportAnswer(event.body,knowledge):null;
  const fresh=Boolean(event.reply_token&&event.reply_expires_at&&Date.parse(event.reply_expires_at)>Date.now()+30000&&Date.parse(event.occurred_at)>Date.now()-300000);
  const review=(text:string)=>formatLineSupportDraftNotice(event.conversation_id,{text,sourceUrls:[],missingInformation:[event.reply_fallback_reason==='unknown'
    ?'自動案内が届いている可能性があります。二重返信を避け、公式LINEの履歴を確認してください。'
    :'自動応答の期限・結果・現在の相談内容を、公式LINEの履歴で確認してください。']});
  if(decision.action==='reply'&&fresh&&!event.reply_fallback_reason){body=decision.text;model='public-facts-v1';kind='customer_reply';}
  else if(verified&&(decision.action==='reply'||event.reply_fallback_reason)){
    kind='operator_draft';proposal=verified.text;body=review(proposal);model='public-facts-review-v1';
  }
  else {
    kind = 'operator_draft';
    const history = await lineSupportRpc('line_support_history', { p_conversation_id: event.conversation_id }, supportHistorySchema);
    const generated = await generateLineSupportDraft(history, knowledge,event.conversation_id);
    if (generated.state === 'ready') {
      body = formatLineSupportDraftNotice(event.conversation_id, generated.draft);
      proposal=generated.draft.text;
      model = generated.model;
    } else {
      // Quota or provider failure must not hide the consultation: finish the event once and
      // notify the operator on Slack with fixed text. No AI content and nothing to the customer.
      const notice = formatLineSupportFallbackNotice(event.conversation_id);
      const done = await lineSupportRpc('complete_line_support_without_delivery', {
        p_event_id: event.event_id, p_lease_id: leaseId, p_draft_id: randomUUID(),
        p_knowledge_revision: knowledge.revision, p_body: notice, p_model_version: 'fallback-notice-v1',
      }, supportOperationSchema);
      if (done.status === 'completed') {
        const posted = await postToSlack({ text: notice, unfurl_links: false });
        if (!posted.ok) console.warn('[line-support-fallback]', posted.error);
      }
      return;
    }
  }
  const deliveryId=randomUUID(),retryKey=randomUUID();
  const prepare=()=>lineSupportRpc('prepare_line_support_delivery', {
    p_event_id: event.event_id, p_lease_id: leaseId, p_delivery_id: deliveryId, p_retry_key: retryKey,
    p_kind: kind, p_knowledge_revision: knowledge.revision, p_body: body, p_model_version: model,p_proposal_text:proposal,
  }, supportOperationSchema);
  let result=await prepare();
  if(result.status==='reply_expired'&&kind==='customer_reply'){proposal=body;body=review(proposal);kind='operator_draft';model='public-facts-review-v1';result=await prepare();}
  if (result.status === 'prepared' && result.delivery_id) await dispatchLineSupportDelivery(result.delivery_id);
}

/** Called by receipt and authorised operator refresh; at most five conversations per request. */
export async function processLineSupportPending(): Promise<{processed:number;failed:number}> {
  const pending = await lineSupportRpc('line_support_work', {}, z.array(z.object({ event_id: z.string() })).max(5));
  // A slow provider must not consume five sequential request timeouts. Database
  // leases and the shared provider quota still arbitrate each independent job.
  const results = await Promise.allSettled(pending.map(async event => {
    await processLineSupportEvent(event.event_id);
    const job=await lineSupportRpc('line_support_job_status',{p_event_id:event.event_id},supportJobSchema);
    if(job?.state==='pending'||job?.state==='processing')throw new Error('Support work remains pending');
    if(job?.delivery_id&&job.rollout==='live'){
      await dispatchLineSupportDelivery(job.delivery_id);
      const current=await lineSupportRpc('line_support_job_status',{p_event_id:event.event_id},supportJobSchema);
      if(current&&(current.delivery_id||current.state==='pending'||current.state==='processing'))throw new Error('Support delivery remains pending');
    }
  }));
  const failed = results.filter(result => result.status === 'rejected').length;
  return {processed: results.length - failed, failed};
}
