/** @jest-environment node */
import {renderToStaticMarkup} from 'react-dom/server';
import Points from '../mypage/points/page';
import Coupons from '../mypage/coupons/page';
import Bookings from '../mypage/bookings/page';
import Blog from '../admin/blog/page';
import PlatformBlog from '../admin/platform-blog/page';
import Catalog from '../admin/catalog/page';
import Funnel from '../admin/funnel/page';
import Usage from '../admin/usage-stats/page';
import Customers from '../admin/customers/page';
import Customer from '../admin/customers/[id]/page';
const mockAuth=jest.fn(),mockFrom=jest.fn(),mockService=jest.fn(),mockCatalog=jest.fn();
let mockFaultTable='',mockFault='',mockPage='';
let mockCount:number|null|undefined=1;let mockNoMembership=false;let mockPlatformDenied=false;
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockAuth},from:mockFrom})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockService()}));
jest.mock('@/lib/catalogs',()=>({getCatalogsByFacility:()=>mockCatalog()}));
jest.mock('@/lib/points-balance',()=>({readPointsBalance:async()=>0}));
jest.mock('@/lib/admin',()=>({getUniqueCustomers:async()=>[],getCustomerVisits:async()=>[]}));
jest.mock('@/components/admin/CustomersManager',()=>({__esModule:true,default:()=> <div>private-customer-controls</div>}));
jest.mock('next/navigation',()=>({notFound:()=>{throw new Error('NEXT_NOT_FOUND');},redirect:()=>{throw new Error('NEXT_REDIRECT');}}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn(),safeJsonLd:JSON.stringify}));
const id='11111111-1111-4111-8111-111111111111',user={id:'synthetic-user'};
const cases=[
 {name:'points',run:()=>Points(),tables:['user_points']},
 {name:'coupons',run:()=>Coupons(),tables:['favorites','coupons','facility_profiles']},
 {name:'bookings',run:()=>Bookings(),tables:['bookings','facility_profiles']},
 {name:'blog',run:()=>Blog(),tables:['facility_members','blog_posts']},
 {name:'platform-blog',run:()=>PlatformBlog(),tables:['profiles','platform_blog_posts']},
 {name:'catalog',run:()=>Catalog(),tables:['facility_members','treatment_catalogs']},
 {name:'funnel',run:()=>Funnel(),tables:['facility_members','facility_page_views','bookings','facility_reviews']},
 {name:'usage',run:()=>Usage(),tables:['facility_members','bookings']},
 {name:'customers',run:()=>Customers(),tables:['facility_members','facility_profiles']},
 {name:'customer',run:()=>Customer({params:Promise.resolve({id})}),tables:['facility_members','customers']},
];
function dataFor(table:string){
 if(table==='facility_members')return mockNoMembership?[]:[{facility_id:id,role:'owner'}];
 if(table==='profiles')return [{is_platform_admin:!mockPlatformDenied}];
 if(table==='facility_profiles')return [{id,name:'Synthetic facility',slug:'synthetic'}];
 if(table==='favorites')return [{facility_id:id}];
 if(table==='coupons')return [{id,name:'Synthetic coupon',discount_type:'fixed',discount_value:100,special_price:null,valid_until:null,facility_id:id}];
 if(table==='customers')return [{id,name:'Synthetic customer',email:null,facility_id:id}];
 if(table==='bookings'&&mockPage==='bookings')return [{id,facility_id:id,booking_date:'2026-10-16',start_time:'10:00',end_time:'10:30',status:'completed',total_price:100,menu_id:null,staff_id:null}];
 return [];
}
function query(table:string){
 const finish=(single=false)=>{if(table===mockFaultTable&&mockFault==='throw')return Promise.reject(new Error('private-db-diagnostic'));const data=dataFor(table);return Promise.resolve({data:table===mockFaultTable&&mockFault==='null-error'?null:single?data[0]??null:data,count:mockCount,error:table===mockFaultTable?{code:'08006',message:'private-db-diagnostic'}:null});};
 const q:Record<string,unknown>={then:(resolve:unknown,reject:unknown)=>finish().then(resolve as never,reject as never),single:()=>finish(true),maybeSingle:()=>finish(true)};
 for(const method of ['select','eq','in','order','limit','gte'])q[method]=jest.fn(()=>q);return q;
}
beforeEach(()=>{jest.clearAllMocks();mockFaultTable='';mockFault='';mockCount=1;mockNoMembership=false;mockPlatformDenied=false;mockAuth.mockResolvedValue({data:{user},error:null});mockFrom.mockImplementation(query);mockService.mockReturnValue({from:mockFrom});mockCatalog.mockResolvedValue([]);});
describe.each(cases)('$name page',testCase=>{
 beforeEach(()=>{mockPage=testCase.name;});
 test.each(['data-error','null-error','throw'])('uncertain auth %s shows retry before private reads',async fault=>{
  if(fault==='throw')mockAuth.mockRejectedValue(new Error('private-auth-diagnostic'));else mockAuth.mockResolvedValue({data:{user:fault==='data-error'?user:null},error:{message:'private-auth-diagnostic'}});
  const html=renderToStaticMarkup(await testCase.run());expect(html).toContain('role="alert"');expect(html).not.toContain('private-auth-diagnostic');expect(mockFrom).not.toHaveBeenCalled();expect(mockService).not.toHaveBeenCalled();expect(mockCatalog).not.toHaveBeenCalled();
 });
 test('genuine anonymous keeps not-found boundary',async()=>{mockAuth.mockResolvedValue({data:{user:null},error:null});await expect(testCase.run()).rejects.toThrow('NEXT_NOT_FOUND');});
 test('successful reads keep the existing page',async()=>{const html=renderToStaticMarkup(await testCase.run());expect(html).not.toContain('role="alert"');if(testCase.name==='catalog')expect(mockCatalog).not.toHaveBeenCalled();});
 test.each(testCase.tables.flatMap(table=>['data-error','null-error','throw'].map(fault=>[table,fault])))('%s %s is an explicit read failure rather than empty or partial data',async(table,fault)=>{
  mockFaultTable=table;mockFault=fault;
  if(testCase.name==='points'||table==='profiles'){const html=renderToStaticMarkup(await testCase.run());expect(html).toContain('role=\"alert\"');expect(html).not.toContain('private-db-diagnostic');}
  else await expect(testCase.run()).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
 });
});

test.each(cases.filter(c=>c.name.startsWith('customer')||['blog','catalog','funnel','usage'].includes(c.name)))('$name genuine missing membership keeps 404',async testCase=>{mockPage=testCase.name;mockNoMembership=true;await expect(testCase.run()).rejects.toThrow('NEXT_NOT_FOUND');expect(mockService).not.toHaveBeenCalled();});
test('platform blog genuine denied privilege stays 404',async()=>{mockPlatformDenied=true;await expect(PlatformBlog()).rejects.toThrow('NEXT_NOT_FOUND');});
test.each([null,undefined,-1,NaN,Infinity,1.5])('funnel unknown or invalid count %s does not become zero',async count=>{mockPage='funnel';mockCount=count;await expect(Funnel()).rejects.toThrow('PAGE_DATA_UNAVAILABLE');});
test('genuine zero funnel counts still render the analytics page',async()=>{mockPage='funnel';mockCount=0;const html=renderToStaticMarkup(await Funnel());expect(html).toContain('ページ閲覧');expect(html).not.toContain('role="alert"');});
