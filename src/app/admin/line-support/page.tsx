import LineSupportConsole from '@/components/admin/LineSupportConsole';
import { z } from 'zod';
export const metadata={title:'LINEの相談'};
export default async function LineSupportPage({searchParams}:{searchParams:Promise<{case?:string|string[]}>}){
  const params=await searchParams;
  const initialConversationId=z.uuid().safeParse(params.case).data;
  return <LineSupportConsole key={initialConversationId??'inbox'} initialConversationId={initialConversationId}/>;
}
