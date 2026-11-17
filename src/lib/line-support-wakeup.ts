/** A Node-only server has no Cloudflare durable queue binding. */
export function isLineSupportQueueConfigured(): boolean { return false; }

/** A Next-only development server cannot promise durable background execution. */
export async function enqueueLineSupportEvents(_ids: string[]): Promise<void> {
  if(_ids.length===0)return;
  throw new Error('Durable LINE support queue is not configured');
}
