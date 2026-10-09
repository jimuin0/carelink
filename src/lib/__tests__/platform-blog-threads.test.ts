/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { publishArticleToThreads, reconcileArticleThreads } from '../platform-blog-threads';
import { publishThreadsText, readThreadsContainerStatus } from '../threads';
import { alertWarning } from '../alert';
jest.mock('../threads',()=>({publishThreadsText:jest.fn(),readThreadsContainerStatus:jest.fn(),buildArticlePostText:(t:string,u:string)=>`${t} ${u}`}));
jest.mock('../alert',()=>({alertWarning:jest.fn()}));
const attempt='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const post={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'old',slug:'old'};
const call=jest.fn();const db={rpc:call} as unknown as Parameters<typeof publishArticleToThreads>[0];
beforeEach(()=>{
 jest.clearAllMocks();call.mockImplementation(async name=>({error:null,data:name==='claim_threads_article'?{attemptId:attempt,title:'frozen',slug:'frozen'}:name==='start_threads_article_publish'?true:'published'}));
 (publishThreadsText as jest.Mock).mockImplementation(async (_text,options)=>{await options.beforePublish('123');return {outcome:'published',postId:'456'};});
});
test('start fence commits before public call and authoritative claim freezes current article text',async()=>{
 expect(await publishArticleToThreads(db,post,'route')).toBe('published');
 expect(call.mock.calls.map(c=>c[0])).toEqual(['claim_threads_article','start_threads_article_publish','finish_threads_article_publish']);
 expect(publishThreadsText).toHaveBeenCalledWith(expect.stringContaining('frozen'),expect.any(Object));
 expect(call).toHaveBeenLastCalledWith('finish_threads_article_publish',expect.objectContaining({p_attempt_id:attempt,p_post_id_external:'456'}));
});
test.each([{data:null,error:null},{data:{attemptId:attempt,title:'x',slug:'x'},error:{message:'partial'}},{data:{attemptId:'bad'},error:null}])('lost/failed/malformed claim never invokes provider',async response=>{
 call.mockResolvedValue(response);await publishArticleToThreads(db,post,'route');expect(publishThreadsText).not.toHaveBeenCalled();
});
test('uncertain start cannot authorize publish; unknown exception is never released as transient',async()=>{
 call.mockImplementation(async name=>({data:name==='claim_threads_article'?{attemptId:attempt,title:'x',slug:'x'}:null,error:null}));
 expect(await publishArticleToThreads(db,post,'route')).toBe('ambiguous');
 expect(call).toHaveBeenLastCalledWith('finish_threads_article_publish',expect.objectContaining({p_outcome:'unknown'}));
});
test.each([{outcome:'published'},{outcome:'unknown'},{outcome:'published',postId:'bad'}])('missing/unknown public ID is isolated, not a successful null finalize',async outcome=>{
 (publishThreadsText as jest.Mock).mockResolvedValue(outcome);call.mockImplementation(async name=>({data:name==='claim_threads_article'?{attemptId:attempt,title:'x',slug:'x'}:'ambiguous',error:null}));
 expect(await publishArticleToThreads(db,post,'route')).toBe('ambiguous');
 expect(call).toHaveBeenLastCalledWith('finish_threads_article_publish',expect.objectContaining({p_outcome:'unknown',p_post_id_external:null}));
});
test('accepted publication with lost DB finalize reply is not counted as published',async()=>{
 call.mockImplementation(async name=>({error:name==='finish_threads_article_publish'?{message:'lost reply'}:null,data:name==='claim_threads_article'?{attemptId:attempt,title:'x',slug:'x'}:true}));
 expect(await publishArticleToThreads(db,post,'route')).toBe('ambiguous');expect(alertWarning).toHaveBeenCalled();
});
test.each(['skipped','transient','permanent'])('known pre-publication %s is finalized through guarded RPC only',async outcome=>{
 (publishThreadsText as jest.Mock).mockResolvedValue({outcome,reason:'private access_token'});call.mockImplementation(async name=>({data:name==='claim_threads_article'?{attemptId:attempt,title:'x',slug:'x'}:outcome,error:null}));
 expect(await publishArticleToThreads(db,post,'route')).toBe(outcome);expect(JSON.stringify((alertWarning as jest.Mock).mock.calls)).not.toContain('private access_token');
});
test.each([null,'FINISHED','IN_PROGRESS','ERROR','EXPIRED'])('reconciliation status %p never authorizes another publish or an invented post ID',async status=>{
 (readThreadsContainerStatus as jest.Mock).mockResolvedValue(status);expect(await reconcileArticleThreads(db,{id:post.id,attemptId:attempt,creationId:'123'})).toBe(false);
 expect(call).not.toHaveBeenCalled();expect(publishThreadsText).not.toHaveBeenCalled();
});
test('PUBLISHED read proof only updates the matching durable attempt and creation ID',async()=>{
 (readThreadsContainerStatus as jest.Mock).mockResolvedValue('PUBLISHED');call.mockResolvedValue({data:true,error:null});
 expect(await reconcileArticleThreads(db,{id:post.id,attemptId:attempt,creationId:'123'})).toBe(true);
 expect(call).toHaveBeenCalledWith('reconcile_threads_article_publish',{p_post_id:post.id,p_attempt_id:attempt,p_creation_id:'123',p_provider_status:'PUBLISHED'});
 expect(publishThreadsText).not.toHaveBeenCalled();
 call.mockResolvedValue({data:true,error:{message:'partial'}});expect(await reconcileArticleThreads(db,{id:post.id,attemptId:attempt,creationId:'123'})).toBe(false);
});
test('legacy unknown claim without container evidence stays held',async()=>{
 expect(await reconcileArticleThreads(db,{id:post.id,attemptId:null,creationId:null})).toBe(false);expect(readThreadsContainerStatus).not.toHaveBeenCalled();
});
