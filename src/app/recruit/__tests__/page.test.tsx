/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecruitPage from '../page';
import { businessTypes } from '@/lib/constants';
import { salonInsertSchema } from '@/lib/validations';
import { SALON_RECRUIT_BROWSER_CONTEXT_KEY, SALON_BROWSER_CONTEXT_KEY } from '@/lib/salon-browser-context';
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: async () => null }));
const intentId='11111111-2222-4333-8444-555555555551';
const receiptId='11111111-2222-4333-8444-555555555552';
const response=(status:number,body:unknown)=>({ok:status>=200&&status<300,status,json:async()=>body});
let commit: jest.Mock, status: jest.Mock, prepare: jest.Mock, requests: jest.Mock;
beforeEach(()=>{
 window.sessionStorage.clear();
 commit=jest.fn(async()=>response(201,{state:'committed',receiptId}));
 status=jest.fn(async()=>response(200,{state:'uncommitted'}));
 prepare=jest.fn(async()=>response(201,{state:'prepared',intentId,consumerVersion:2,photoLimits:{maxBytes:10485760,mimeTypes:['image/png','image/jpeg','image/webp','image/gif']}}));
 requests=jest.fn((url:string,init:RequestInit)=>{
  if(url==='/api/salons/prepare')return prepare(init);
  if(url==='/api/salons/commit')return commit(init);
  if(url==='/api/salons/status')return status(init);
  throw new Error('unexpected legacy endpoint');
 });
 global.fetch=requests as unknown as typeof fetch;
});
afterEach(()=>jest.restoreAllMocks());
function fill(container:HTMLElement,overrides:Record<string,string>={}){
 const values={facility_name:'Synthetic facility',business_type:'ヘアサロン',representative_name:'山田太郎',contact_name:'山田花子',email:'test@example.invalid',phone:'090-1234-5678',...overrides};
 for(const [name,value] of Object.entries(values))fireEvent.change(container.querySelector(`[name="${name}"]`)!,{target:{value}});
}
async function step2(container:HTMLElement,overrides:Record<string,string>={}){
 fill(container,overrides);fireEvent.click(screen.getByRole('button',{name:'次へ'}));await screen.findByLabelText('郵便番号');
}
function consent(){
 fireEvent.click(screen.getByRole('checkbox',{name:/利用規約/}));
 fireEvent.click(screen.getByRole('checkbox',{name:/資格|許認可/}));
}
async function submit(container:HTMLElement,overrides:Record<string,string>={}){
 await step2(container,overrides);fireEvent.change(container.querySelector('[name="address"]')!,{target:{value:'東京都港区芝公園1-1-1'}});consent();fireEvent.click(screen.getByRole('button',{name:'掲載を申し込む'}));
}
test.each(businessTypes)('category %s uses the durable recruit contract and confirmed receipt',async business_type=>{
 const {container}=render(<RecruitPage/>);await submit(container,{business_type});
 expect(await screen.findByText('掲載申し込みが完了しました')).toBeVisible();
 expect(screen.getByText(`受付番号：${receiptId}`)).toBeVisible();expect(prepare).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);
 const input=JSON.parse(commit.mock.calls[0][0].body);
 expect(input).toMatchObject({intentId,photoIds:[],consent:{terms_agreed:true,license_warranted:true},registration:{source:'recruit',business_type}});
 expect(salonInsertSchema.safeParse(input.registration).success).toBe(true);
 expect(requests.mock.calls.every(([url])=>url!=='/api/salons')).toBe(true);
});
test.each(['network','pending','malformed','wrong-receipt','legacy-response'])('uncertain %s commit retains input and blocks a new registration',async failure=>{
 if(failure==='network')commit.mockRejectedValue(new Error('lost reply'));
 else if(failure==='malformed')commit.mockResolvedValue({ok:true,status:200,json:async()=>{throw new Error('bad JSON');}});
 else commit.mockResolvedValue(response(failure==='pending'?202:200,failure==='wrong-receipt'?{state:'committed',receiptId:'wrong'}:failure==='legacy-response'?{success:true,id:receiptId}:{state:'unknown'}));
 const {container}=render(<RecruitPage/>);await submit(container);await screen.findByRole('alert');
 expect(screen.queryByText('掲載申し込みが完了しました')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'掲載を申し込む'})).toBeDisabled();expect(prepare).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);
 expect(container.querySelector('[name="address"]')).toHaveValue('東京都港区芝公園1-1-1');
});
test('lost reply is replayed only after same-intent status verification with identical original body',async()=>{
 commit.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce(response(200,{state:'replay',receiptId}));
 const {container}=render(<RecruitPage/>);await submit(container);await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'同じ申込の受付状況を確認する'}));
 expect(await screen.findByText('掲載申し込みが完了しました')).toBeVisible();
 expect(prepare).toHaveBeenCalledTimes(1);expect(status).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(2);
 expect(commit.mock.calls[1][0].body).toBe(commit.mock.calls[0][0].body);
});
test('reload reconciles a committed selector without a new preparation or empty payload',async()=>{
 window.sessionStorage.setItem(SALON_RECRUIT_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId,phase:'attempted'}));
 status.mockResolvedValue(response(200,{state:'committed',receiptId}));render(<RecruitPage/>);
 expect(await screen.findByText('掲載申し込みが完了しました')).toBeVisible();expect(prepare).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
});
test('reload of an uncommitted attempted selector cannot reconstruct or send a new body',async()=>{
 window.sessionStorage.setItem(SALON_RECRUIT_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId,phase:'attempted'}));render(<RecruitPage/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'同じ申込の受付状況を確認する'}));
 await waitFor(()=>expect(status).toHaveBeenCalledTimes(2));expect(prepare).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
});
test('preparation failure keeps fields editable and does not attempt commit',async()=>{
 prepare.mockRejectedValue(new Error('unavailable'));
 const {container}=render(<RecruitPage/>);await submit(container);await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'掲載を申し込む'})).toBeEnabled();expect(commit).not.toHaveBeenCalled();
});
test('declarations are required before preparation',async()=>{
 const {container}=render(<RecruitPage/>);await step2(container);
 fireEvent.click(screen.getByRole('button',{name:'掲載を申し込む'}));
 expect(prepare).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
});
test.each(['1234567890','0-1'])('invalid phone %s remains on step1',async phone=>{
 const {container}=render(<RecruitPage/>);fill(container,{phone});fireEvent.click(screen.getByRole('button',{name:'次へ'}));
 expect(await screen.findByText('正しい電話番号を入力してください')).toBeVisible();expect(prepare).not.toHaveBeenCalled();
});
test('full-width phone is normalized before validation',()=>{
 const {container}=render(<RecruitPage/>);const input=container.querySelector('[name="phone"]')!;
 fireEvent.change(input,{target:{value:'０９０－１２３４－５６７８'}});expect(input).toHaveValue('090-1234-5678');
});
test('unavailable session storage blocks new preparation',async()=>{
 jest.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked storage');});render(<RecruitPage/>);
 await screen.findByRole('alert');expect(prepare).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
});

test.each(['prepared','attempted','confirmed'])('register %s context cannot complete or block a recruit application', async phase => {
 window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId,phase}));
 const original = window.sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY);
 const {container}=render(<RecruitPage/>);await submit(container);
 expect(await screen.findByText('掲載申し込みが完了しました')).toBeVisible();
 expect(prepare).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);expect(status).not.toHaveBeenCalled();
 expect(window.sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)).toBe(original);
 expect(JSON.parse(window.sessionStorage.getItem(SALON_RECRUIT_BROWSER_CONTEXT_KEY)!)).toEqual({version:1,intentId,phase:'confirmed'});
});
