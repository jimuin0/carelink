'use client';

import { useCallback,useEffect,useRef,useState } from 'react';
import { z } from 'zod';
import { supportListSchema,supportDetailSchema,type supportCommandSchema } from '@/lib/line-support-contract';

type List=z.infer<typeof supportListSchema>;
type Detail=z.infer<typeof supportDetailSchema>;
const modeLabels={automatic:'自動案内',human:'手動対応中',closed:'対応済み'};
const stateLabels:Record<string,string>={pending:'通知待ち',sending:'送信結果の記録待ち',accepted:'LINE受付済み（受信は未確認）',unknown:'結果不明・確認が必要',failed:'送信失敗',superseded:'送信対象外（確認モード・更新済みなど）'};
const commandResult=z.object({pairingText:z.string().optional(),status:z.string().optional(),processed:z.number().optional(),failed:z.number().optional(),error:z.string().optional()});

export default function LineSupportConsole({initialConversationId}:{initialConversationId?:string}={}){
  const [list,setList]=useState<List|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [selection,setSelection]=useState<string|null>(initialConversationId??null);
  const [pairing,setPairing]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(true);
  const [loadFailed,setLoadFailed]=useState(false);
  const sequence=useRef(0);
  const load=useCallback(async(id:string|null)=>{
    const generation=++sequence.current;
    setBusy(true);setLoadFailed(false);
    try{
      const response=await fetch('/api/admin/line-support'+(id?'?id='+encodeURIComponent(id):''),{cache:'no-store'});
      if(!response.ok)throw new Error('相談を読み込めません。ログイン状態と運営権限をご確認ください。');
      const value:unknown=await response.json();
      if(generation!==sequence.current)return;
      if(id)setDetail(supportDetailSchema.parse(value));else setList(supportListSchema.parse(value));
    }catch{
      if(generation===sequence.current){setLoadFailed(true);setNotice('最新の相談を確認できませんでした。保存済みの表示を最新と判断せず、再読み込みしてください。');}
    }finally{if(generation===sequence.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/admin/line-support',{cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('unavailable');return supportListSchema.parse(await response.json());})
      .then(async value=>{
        if(controller.signal.aborted)return;
        setList(value);
        if(initialConversationId){
          const response=await fetch('/api/admin/line-support?id='+encodeURIComponent(initialConversationId),{cache:'no-store',signal:controller.signal});
          if(!response.ok)throw new Error('unavailable');
          const selected=supportDetailSchema.parse(await response.json());
          if(!controller.signal.aborted)setDetail(selected);
        }
      })
      .catch(()=>{if(!controller.signal.aborted){setLoadFailed(true);setNotice('相談を確認できませんでした。ログイン状態と運営権限をご確認ください。');}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[initialConversationId]);
  async function command(data:z.infer<typeof supportCommandSchema>){
    if(busy)return;
    setBusy(true);setNotice('');
    try{
      const response=await fetch('/api/admin/line-support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const parsed=commandResult.safeParse(await response.json());
      if(!parsed.success)throw new Error('操作結果を確認できませんでした。一覧を更新してください。');
      const result=parsed.data;
      if(!response.ok)throw new Error(result.error||'操作結果を確認できませんでした。');
      if(result.pairingText)setPairing(result.pairingText);
      if(data.action==='pair_confirm'||data.action==='unbind')setPairing('');
      setNotice(data.action==='recover'?(result.failed?'一部の返信案を作成できませんでした。相談は保存されています。':'未処理の相談を確認しました。'):'操作を記録しました。');
      await load(null);
      if(selection)await load(selection);
    }catch(error){setNotice(error instanceof Error?error.message:'操作結果を確認できませんでした。');}
    finally{setBusy(false);}
  }
  const disabled=busy||loadFailed;
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">LINEの相談</h1>
    <p>返信案はお客様には送信しません。最新の追記を確認し、公式LINEのチャットから手動で返信してください。</p>
    <p>本人LINEへの文案通知は公式LINEの配信枠を使用します。枠が不足した場合は送信せず保存します。通常の自動案内には、配信枠を使わない応答を使用します。</p>
    {notice&&<p role="status" className="rounded border p-3">{notice}</p>}
    <section className="space-y-3 rounded border p-4" aria-labelledby="line-recipient-heading">
      <h2 id="line-recipient-heading" className="text-lg font-bold">返信案の通知先</h2>
      <p>{list?.settings.recipient_verified?'本人LINEの通知先を確認済み':'通知先は未確認です。返信案は相談一覧に保存されます。'}</p>
      <p>通知先を解除すると確認モードに戻り、自動案内も停止します。</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={()=>void command({action:'pair_start'})}>連携用の文を発行</button>
        <button type="button" className="btn-secondary" disabled={disabled||!list?.settings.pair_pending} onClick={()=>void command({action:'pair_confirm'})}>自分のLINEから送ったことを確認して連携</button>
        <button type="button" className="btn-secondary" disabled={disabled||!list?.settings.recipient_verified} onClick={()=>void command({action:'unbind'})}>通知先を解除</button>
      </div>
      {pairing&&<div className="space-y-2 rounded bg-gray-50 p-3"><p>10分以内に、通知を受け取る個人LINEからcarelink公式LINEへ次の文を送ってください。その後「一覧を更新」を押し、連携を確定してください。</p><textarea aria-label="LINEへ送る連携用の文" className="form-input w-full" readOnly value={pairing}/></div>}
    </section>
    <section className="space-y-3 rounded border p-4" aria-labelledby="line-mode-heading">
      <h2 id="line-mode-heading" className="text-lg font-bold">応答の状態</h2>
      <p>{list?.settings.rollout==='live'?'自動案内と返信案の通知を有効にしています。':list?.settings.rollout==='off'?'受信を停止しています。':'確認モードです。受信と返信案を保存し、LINEへの送信は行いません。'}</p>
      {list&&!list.readiness.configured&&<p>開始に必要な設定が不足しています。自動案内と通知は有効にできません。{list.readiness.missing.map(code=>({enabled:'受信機能',line:'公式LINEとの接続',drafts:'返信案の作成',quota:'返信案の利用上限',processing:'受信後の処理',version:'稼働バージョン'}[code])).join('・')}の設定をご確認ください。</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={()=>void command({action:'rollout',mode:'observe'})}>確認モードにする</button>
        <button type="button" className="btn-primary" disabled={disabled||!list?.settings.recipient_verified||!list?.readiness.configured} onClick={()=>void command({action:'rollout',mode:'live'})}>自動案内と通知を有効にする</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={()=>void (async()=>{await load(null);if(selection)await load(selection);})()}>一覧を更新</button>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={()=>void command({action:'recover'})}>未処理の相談を再確認</button>
      </div>
    </section>
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="line-cases-heading"><h2 id="line-cases-heading" className="mb-3 text-lg font-bold">相談一覧</h2>
        {list?.conversations.length===0&&<p>保存された相談はありません。</p>}
        <ul className="space-y-2">{list?.conversations.map(item=><li key={item.id}><button type="button" disabled={busy} className="w-full rounded border p-3 text-left" onClick={()=>{setSelection(item.id);setDetail(null);void load(item.id);}}>
          <span className="font-medium">相談 {item.id.slice(0,8)}</span> · {modeLabels[item.mode]} · {new Date(item.updated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}
          {item.blocked&&<span> · LINEブロック済み</span>}
        </button></li>)}</ul>
      </section>
      <section aria-labelledby="line-detail-heading"><h2 id="line-detail-heading" className="mb-3 text-lg font-bold">相談内容と返信案</h2>
        {detail?<div className="space-y-4">
          <p>{modeLabels[detail.conversation.mode]} · 更新番号 {detail.conversation.revision}</p>
          <div className="flex flex-wrap gap-2">{(['human','closed','automatic'] as const).map(mode=><button key={mode} type="button" className="btn-secondary" disabled={disabled} onClick={()=>void command({action:'mode',conversationId:detail.conversation.id,revision:detail.conversation.revision,mode})}>{mode==='human'?'手動対応にする':mode==='closed'?'対応済みにする':'自動案内へ戻す'}</button>)}</div>
          <ol className="space-y-3">{detail.events.map(event=><li className="rounded border p-3" key={event.event_id}><p className="text-sm">{event.message_type} · {new Date(event.occurred_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</p><p className="whitespace-pre-wrap">{event.body}</p></li>)}</ol>
          {detail.drafts.map(draft=><article className="rounded border p-3" key={draft.id}><h3 className="font-bold">返信案（手動送信用）{draft.conversation_revision!==detail.conversation.revision?' · 古い案です':''}{draft.knowledge_revision!==detail.currentKnowledgeRevision?' · 公開情報の更新前の案です':''}</h3><p className="whitespace-pre-wrap">{draft.body}</p></article>)}
          {detail.deliveries.map(item=><article key={item.id}><p>{item.kind==='operator_draft'?'本人LINEへの通知':'お客様への自動案内'}：{stateLabels[item.state]||'状況を確認してください'}</p>{item.preview&&<p className="whitespace-pre-wrap rounded border p-3">{item.preview}</p>}</article>)}
        </div>:<p>相談を選ぶと内容を確認できます。</p>}
      </section>
    </div>
  </div>;
}
