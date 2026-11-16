import { z } from 'zod';

// This rollout is limited to the currently verified 200-message account ceiling.
// A larger or unlimited plan requires an explicit budget decision before enabling it.
const quota=z.object({type:z.literal('limited'),value:z.number().int().min(0).max(200)});
const consumption=z.object({totalUsage:z.number().int().nonnegative()});
export async function hasLineSupportQuota(token:string):Promise<boolean>{
  try{
    const read=async(path:string)=>{
      const response=await fetch('https://api.line.me/v2/bot/message/'+path,{
        headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000),redirect:'manual',cache:'no-store',
      });
      if(!response.ok)throw new Error('Quota unavailable');
      return response.json() as Promise<unknown>;
    };
    const [allowed,used]=await Promise.all([read('quota'),read('quota/consumption')]);
    const limit=quota.parse(allowed);const count=consumption.parse(used);
    return count.totalUsage<limit.value;
  }catch{return false;}
}
