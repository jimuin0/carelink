import '@testing-library/jest-dom';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import LineSupportConsole from '@/components/admin/LineSupportConsole';
const priorFetch=global.fetch;
const id='10000000-0000-4000-8000-000000000001';
const conversation={id,mode:'human',revision:2,blocked:false,updated_at:'2026-11-15T00:00:00Z'};
const list={readiness:{configured:true,missing:[]},settings:{rollout:'observe',recipient_verified:false,recipient_version:0,pair_pending:false},conversations:[conversation]};
const detail={currentKnowledgeRevision:'a'.repeat(64),conversation,events:[{event_id:'synthetic',revision:2,message_type:'text',body:'ログインできません',withdrawn:false,occurred_at:'2026-11-15T00:00:00Z',received_at:'2026-11-15T00:00:00Z'}],drafts:[{id,conversation_revision:1,knowledge_revision:'a'.repeat(64),model_version:'existing',body:'確認いたします。',created_at:'2026-11-15T00:00:00Z'}],deliveries:[{id,conversation_revision:2,kind:'operator_draft',state:'unknown',preview:null,attempts:1,created_at:'2026-11-15T00:00:00Z'}]};
function response(value:unknown,ok=true){return {ok,json:async()=>value} as Response;}
beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue(response(list));});
afterEach(()=>{global.fetch=priorFetch;});
test('initial failure never masquerades as an empty inbox or enables sending',async()=>{
 (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));render(<LineSupportConsole/>);
 expect(await screen.findByRole('status')).toHaveTextContent('相談を確認できませんでした');expect(screen.queryByText('保存された相談はありません。')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'自動案内と通知を有効にする'})).toBeDisabled();
 (global.fetch as jest.Mock).mockResolvedValueOnce(response(list));fireEvent.click(screen.getByRole('button',{name:'一覧を更新'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'連携用の文を発行'})).toBeEnabled());
});
test('unverified recipient cannot enable live notifications; pairing text is display only',async()=>{
 render(<LineSupportConsole/>);await screen.findByRole('button',{name:/相談 10000000/});
 expect(screen.getByRole('button',{name:'自動案内と通知を有効にする'})).toBeDisabled();
 (global.fetch as jest.Mock).mockResolvedValueOnce(response({pairingText:'CareLink連携 synthetic'})).mockResolvedValueOnce(response(list));
 fireEvent.click(screen.getByRole('button',{name:'連携用の文を発行'}));
 expect(await screen.findByLabelText('LINEへ送る連携用の文')).toHaveValue('CareLink連携 synthetic');
 expect((global.fetch as jest.Mock).mock.calls.every(([url])=>url.startsWith('/api/admin/line-support'))).toBe(true);
});
test('selected case labels stale drafts and unknown external outcomes accurately',async()=>{
 render(<LineSupportConsole/>);const caseButton=await screen.findByRole('button',{name:/相談 10000000/});
 (global.fetch as jest.Mock).mockResolvedValueOnce(response(detail));fireEvent.click(caseButton);
 expect(await screen.findByText('ログインできません')).toBeInTheDocument();expect(screen.getByText(/古い案です/)).toBeInTheDocument();expect(screen.getByText(/結果不明・確認が必要/)).toBeInTheDocument();
 (global.fetch as jest.Mock).mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response({...detail,events:[{...detail.events[0],body:'新しい追記'}]}));
 fireEvent.click(screen.getByRole('button',{name:'一覧を更新'}));expect(await screen.findByText('新しい追記')).toBeInTheDocument();
});
test('mode changes submit the observed revision and surface conflicts',async()=>{
 render(<LineSupportConsole/>);const caseButton=await screen.findByRole('button',{name:/相談 10000000/});
 (global.fetch as jest.Mock).mockResolvedValueOnce(response(detail));fireEvent.click(caseButton);await screen.findByText('ログインできません');
 (global.fetch as jest.Mock).mockResolvedValueOnce(response({error:'相談内容が変わりました。'},false));fireEvent.click(screen.getByRole('button',{name:'自動案内へ戻す'}));
 expect(await screen.findByRole('status')).toHaveTextContent('相談内容が変わりました。');
 const [,options]=(global.fetch as jest.Mock).mock.calls.find(([,options])=>options?.method==='POST');expect(JSON.parse(options.body)).toEqual({action:'mode',conversationId:id,revision:2,mode:'automatic'});
});
test('malformed operation receipts expose a plain recovery message',async()=>{
 render(<LineSupportConsole/>);await screen.findByRole('button',{name:/相談 10000000/});(global.fetch as jest.Mock).mockResolvedValueOnce(response({pairingText:123}));
 fireEvent.click(screen.getByRole('button',{name:'連携用の文を発行'}));expect(await screen.findByRole('status')).toHaveTextContent('操作結果を確認できませんでした。一覧を更新してください。');
});
test('a personal notification opens the exact case behind the authenticated console',async()=>{
 (global.fetch as jest.Mock).mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(detail));
 render(<LineSupportConsole initialConversationId={id}/>);expect(await screen.findByText('ログインできません')).toBeInTheDocument();
 expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('/api/admin/line-support?id='+id);
});
test('confirmation mode exposes the proposed automatic answer and flags drafts based on obsolete public information',async()=>{
 render(<LineSupportConsole/>);const button=await screen.findByRole('button',{name:/相談 10000000/});
 (global.fetch as jest.Mock).mockResolvedValueOnce(response({...detail,currentKnowledgeRevision:'b'.repeat(64),deliveries:[{...detail.deliveries[0],kind:'customer_reply',state:'superseded',preview:'確認用の自動案内です。'}]}));
 fireEvent.click(button);expect(await screen.findByText('確認用の自動案内です。')).toBeInTheDocument();expect(screen.getByText(/公開情報の更新前の案です/)).toBeInTheDocument();
});

test('a verified recipient cannot enable live mode while runtime settings are missing',async()=>{
 (global.fetch as jest.Mock).mockResolvedValue(response({...list,settings:{...list.settings,recipient_verified:true},readiness:{configured:false,missing:['drafts','processing','enabled','line','quota','version']}}));render(<LineSupportConsole/>);await screen.findByRole('button',{name:/相談 10000000/});const activate=screen.getByRole('button',{name:'自動案内と通知を有効にする'});expect(activate).toBeDisabled();expect(screen.getByText(/開始に必要な設定が不足しています/)).toHaveTextContent('返信案の作成・受信後の処理');fireEvent.click(activate);expect((global.fetch as jest.Mock).mock.calls.every(([,options])=>options?.method!=='POST')).toBe(true);
});
test('both configured runtime and verified recipient are needed to enable the activation control',async()=>{
 (global.fetch as jest.Mock).mockResolvedValue(response({...list,settings:{...list.settings,recipient_verified:true}}));render(<LineSupportConsole/>);await screen.findByRole('button',{name:/相談 10000000/});expect(screen.getByRole('button',{name:'自動案内と通知を有効にする'})).toBeEnabled();
});
