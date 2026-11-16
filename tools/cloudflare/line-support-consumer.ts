type Message={body:unknown;ack():void;retry(options:{delaySeconds:number}):void};
type Batch={messages:Message[]};
type FetchApp=(request:Request,env:unknown,ctx:unknown)=>Promise<Response>;
/** At-least-once queue delivery is reconciled with the DB lease and outbox. */
export async function consumeLineSupport(batch:Batch,env:{CRON_SECRET?:string},ctx:unknown,fetchApp:FetchApp){
  await Promise.all(batch.messages.map(async message=>{
    const body=message.body as {eventId?:unknown}|null;
    if(!body||typeof body.eventId!=='string'||body.eventId.length<1||body.eventId.length>128){message.ack();return;}
    if(!env.CRON_SECRET){message.retry({delaySeconds:120});return;}
    try{
      const response=await fetchApp(new Request('https://carelink-jp.com/api/line/support-work',{
        method:'POST',headers:{Authorization:`Bearer ${env.CRON_SECRET}`,'Content-Type':'application/json'},
        body:JSON.stringify({eventId:body.eventId}),signal:AbortSignal.timeout(55000),
      }),env,ctx);
      if(response.ok)message.ack();else message.retry({delaySeconds:120});
    }catch{message.retry({delaySeconds:120});}
  }));
}
