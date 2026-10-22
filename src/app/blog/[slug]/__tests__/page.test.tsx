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

// 公開日は保存し直しても変わらなくなった（migration 20261022190000）ため、記事を直したことは
// updated_at で dateModified に出す。公開日より前の日付にはしない。
type El = { type?: unknown; props?: { children?: unknown; dangerouslySetInnerHTML?: { __html: string } } };
function findJsonLd(node: unknown): Record<string, unknown> | null {
 if (Array.isArray(node)) { for (const child of node) { const found = findJsonLd(child); if (found) return found; } return null; }
 if (!node || typeof node !== 'object') return null;
 const el = node as El;
 if (el.type === 'script' && el.props?.dangerouslySetInnerHTML) return JSON.parse(el.props.dangerouslySetInnerHTML.__html);
 return findJsonLd(el.props?.children);
}
test.each([
 ['an edited article reports its last update', '2026-10-22T09:00:00+00:00', '2026-10-22'],
 ['an article never edited reports its publish date', null, '2026-03-01'],
 ['an update older than the publish date never precedes it', '2026-02-01T00:00:00+00:00', '2026-03-01'],
])('JSON-LD: %s', async (_label, updated_at, dateModified) => {
 maybeSingle.mockResolvedValue({ data: { ...post, published_at: '2026-03-01T00:00:00+00:00', updated_at }, error: null });
 const jsonLd = findJsonLd(await ArticlePage(request));
 expect(jsonLd).toMatchObject({ datePublished: '2026-03-01', dateModified });
 expect(from.mock.results[0].value.select).toHaveBeenCalledWith(expect.stringContaining('updated_at'));
});
