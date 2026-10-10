/** @jest-environment node */
const maybeSingle=jest.fn(); const from=jest.fn();
jest.mock('@/lib/supabase-server',()=>({createServerSupabaseClient:()=>({from})}));
jest.mock('next/navigation',()=>({notFound:jest.fn(()=>{throw new Error('NOT_FOUND');})}));
import ArticlePage,{generateMetadata} from '../page';
const request={params:Promise.resolve({slug:'synthetic-dynamic-not-in-static'})};
const post={slug:'synthetic-dynamic-not-in-static',title:'Synthetic',description:'Synthetic',category:'other',tags:null,reading_time:1,content:[],published_at:null,author_name:null};
beforeEach(()=>{jest.clearAllMocks();from.mockReturnValue({select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),neq:jest.fn().mockReturnThis(),maybeSingle,limit:jest.fn().mockResolvedValue({data:[]})});});
test('real missing dynamic article remains not-found',async()=>{maybeSingle.mockResolvedValue({data:null,error:null});await expect(ArticlePage(request)).rejects.toThrow('NOT_FOUND');});
test.each([{data:null,error:{}},{data:post,error:{}}])('DB unavailable never becomes404 or accepts inconsistent partial article',async result=>{
 maybeSingle.mockResolvedValue(result);await expect(ArticlePage(request)).rejects.toThrow('Article unavailable');await expect(generateMetadata(request)).rejects.toThrow('Article unavailable');
});
test.each([null,{},[null,{},'safe']])('legacy/malformed tags %j cannot crash rendering',async tags=>{maybeSingle.mockResolvedValue({data:{...post,tags},error:null});await expect(ArticlePage(request)).resolves.toBeDefined();});
