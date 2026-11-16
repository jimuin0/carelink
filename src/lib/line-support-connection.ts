import { z } from 'zod';

const botSchema=z.object({userId:z.string().regex(/^U[0-9a-f]{32}$/),basicId:z.literal('@549rbbyi'),displayName:z.string().min(1).max(100)});

/** Read-only provider check. Never return credentials or trust an unrelated bot. */
export async function readLineSupportConnection(){
  const token=process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  if(!token?.trim())return null;
  try{
    const response=await fetch('https://api.line.me/v2/bot/info',{
      headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000),cache:'no-store',redirect:'error',
    });
    if(!response.ok)return null;
    const bot=botSchema.safeParse(await response.json());
    if(!bot.success)return null;
    return {...bot.data,destinationMatches:bot.data.userId===process.env.LINE_SUPPORT_DESTINATION};
  }catch{return null;}
}
