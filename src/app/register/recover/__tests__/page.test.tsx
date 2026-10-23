import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RecoverRegistrationPage from '../page';
import { buttonClassName } from '@/components/ui/Button';
import { SALON_RECOVERY_CONTEXT_KEY, SALON_RECOVERY_ONBOARDING_PATH } from '@/lib/salon-browser-context';
const mockPush=jest.fn(), mockReplace=jest.fn();
const mockRouter={push:mockPush,replace:mockReplace};
let mockSearch=new URLSearchParams();
jest.mock('next/navigation',()=>({useRouter:()=>mockRouter,useSearchParams:()=>mockSearch}));
const mockFetch=jest.fn();
const receiptId='b1000000-0000-4000-8000-000000000001';
const recoveryId='b2000000-0000-4000-8000-000000000001';
const receipt={receipt_id:receiptId,facility_name:'Synthetic recovery branch',business_type:'ヘアサロン',created_at:null};
const ready={state:'ready',receipts:[receipt],next:null};
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body});
beforeEach(()=>{jest.resetAllMocks();window.sessionStorage.clear();global.fetch=mockFetch;mockSearch=new URLSearchParams();
  mockFetch.mockResolvedValue(response(ready));});
test('StrictMode reads only; selection is explicit, proof and customer fields are absent',async()=>{
  render(<StrictMode><RecoverRegistrationPage/></StrictMode>);
  await screen.findByText(receipt.facility_name);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({action:'list'});
  expect(mockPush).not.toHaveBeenCalled();
  mockFetch.mockResolvedValue(response({state:'prepared',recoveryId,expiresAt:new Date(Date.now()+60000).toISOString()}));
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));
  await waitFor(()=>expect(mockPush).toHaveBeenCalledWith(SALON_RECOVERY_ONBOARDING_PATH));
  expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({action:'prepare',receiptId});
  expect(JSON.parse(window.sessionStorage.getItem(SALON_RECOVERY_CONTEXT_KEY)!)).toEqual({version:1,recoveryId});
  expect(mockFetch.mock.calls.every(call=>call[0]!=='/api/facility/setup')).toBe(true);
});
test('unauthenticated list requests login with recovery destination',async()=>{
  mockFetch.mockResolvedValue(response({},401));render(<RecoverRegistrationPage/>);
  await waitFor(()=>expect(mockReplace).toHaveBeenCalledWith('/auth/login?redirect=%2Fregister%2Frecover'));
  expect(mockPush).not.toHaveBeenCalled();
});
test.each([403,500,503])('failed list is not shown as zero receipts (%s)',async status=>{
  mockFetch.mockResolvedValue(response({},status));render(<RecoverRegistrationPage/>);
  await screen.findByRole('alert');expect(screen.queryByText(/一致する受付を確認できませんでした/)).not.toBeInTheDocument();
});
test('Auth 503 keeps receipt and original selector; explicit retry alone resumes preparation',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  mockFetch.mockResolvedValueOnce(response({code:'AUTH_UNAVAILABLE'},503));
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));
  await screen.findByRole('alert');
  expect(screen.getByText(receipt.facility_name)).toBeInTheDocument();
  expect(mockReplace).not.toHaveBeenCalled();expect(mockPush).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(SALON_RECOVERY_CONTEXT_KEY)).toBeNull();
  mockFetch.mockResolvedValue(response({state:'prepared',recoveryId,expiresAt:new Date(Date.now()+60000).toISOString()}));
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));
  await waitFor(()=>expect(mockPush).toHaveBeenCalledWith(SALON_RECOVERY_ONBOARDING_PATH));
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({action:'prepare',receiptId});
  expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({action:'prepare',receiptId});
});
test('manual retry after failed retrieval restores the same receipt without preparation or re-registration',async()=>{
  mockFetch.mockResolvedValueOnce(response({},500)).mockResolvedValue(response(ready));
  render(<RecoverRegistrationPage/>);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'先頭から再確認'}));
  await screen.findByText(receipt.facility_name);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  for(const [url,options] of mockFetch.mock.calls){
    expect(url).toBe('/api/salons/recovery');
    expect(JSON.parse(options.body)).toEqual({action:'list'});
  }
  expect(mockPush).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(SALON_RECOVERY_CONTEXT_KEY)).toBeNull();
});
test.each([null,{...ready,receipts:[{...receipt,receipt_id:'bad'}]},{...ready,receipts:[{...receipt,email:'private@example.invalid'}]}])('invalid list fails closed %#',async body=>{
  mockFetch.mockResolvedValue(response(body));render(<RecoverRegistrationPage/>);
  await screen.findByRole('alert');expect(mockPush).not.toHaveBeenCalled();
});
test('empty confirmed list is different from retrieval failure',async()=>{
  mockFetch.mockResolvedValue(response({...ready,receipts:[]}));render(<RecoverRegistrationPage/>);
  await screen.findByText(/一致する受付を確認できませんでした/);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('pagination sends only a keyset selector and no re-registration',async()=>{
  mockFetch.mockResolvedValue(response({...ready,next:receiptId}));render(<RecoverRegistrationPage/>);
  fireEvent.click(await screen.findByRole('button',{name:'次の受付を表示'}));
  await waitFor(()=>expect(mockFetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({action:'list',after:receiptId});
});
test.each([response({state:'unverified'}),response({state:'prepared',recoveryId,expiresAt:'2020-01-01T00:00:00Z'}),response({},500)])('denied or expired preparation never navigates %#',async prepared=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);mockFetch.mockResolvedValue(prepared);
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));await screen.findByRole('alert');
  expect(mockPush).not.toHaveBeenCalled();expect(window.sessionStorage.getItem(SALON_RECOVERY_CONTEXT_KEY)).toBeNull();
});
test('blocked storage never navigates or creates a facility',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  mockFetch.mockResolvedValue(response({state:'prepared',recoveryId,expiresAt:new Date(Date.now()+60000).toISOString()}));
  const spy=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
  try {fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));await screen.findByRole('alert');expect(mockPush).not.toHaveBeenCalled();}
  finally {spy.mockRestore();}
});
test('unmounted read cannot navigate or prepare',async()=>{
  let done!:(result:ReturnType<typeof response>)=>void;
  mockFetch.mockReturnValue(new Promise(resolve=>{done=resolve;}));const view=render(<RecoverRegistrationPage/>);view.unmount();
  await act(async()=>done(response({},401)));expect(mockReplace).not.toHaveBeenCalled();expect(mockFetch).toHaveBeenCalledTimes(1);
});
test('StrictMode abandoned response cannot replace a newer list or redirect',async()=>{
  let first!:(result:ReturnType<typeof response>)=>void;
  mockFetch.mockReturnValueOnce(new Promise(resolve=>{first=resolve;})).mockResolvedValue(response(ready));
  render(<StrictMode><RecoverRegistrationPage/></StrictMode>);
  await screen.findByText(receipt.facility_name);
  await act(async()=>first(response({},401)));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByText(receipt.facility_name)).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test('StrictMode abandoned failure cannot show an error after a successful response',async()=>{
  let rejectFirst!:(error:Error)=>void;
  mockFetch.mockReturnValueOnce(new Promise((_resolve,reject)=>{rejectFirst=reject;})).mockResolvedValue(response(ready));
  render(<StrictMode><RecoverRegistrationPage/></StrictMode>);
  await screen.findByText(receipt.facility_name);
  await act(async()=>rejectFirst(new Error('abandoned request')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(receipt.facility_name)).toBeInTheDocument();
});
test('unmount aborts the initial list request',async()=>{
  mockFetch.mockReturnValue(new Promise(()=>{}));
  const view=render(<RecoverRegistrationPage/>);
  const signal=mockFetch.mock.calls[0][1].signal as AbortSignal;
  expect(signal.aborted).toBe(false);view.unmount();expect(signal.aborted).toBe(true);
});

// 🔴 通信断の fetch は TypeError("Failed to fetch") を投げる。以前はその英語の生メッセージを画面に出していた。
test('list network failure shows a Japanese instruction, never the raw "Failed to fetch"',async()=>{
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));render(<RecoverRegistrationPage/>);
  const alert=await screen.findByRole('alert');
  expect(alert).toHaveTextContent('通信できませんでした');expect(alert).not.toHaveTextContent(/Failed to fetch/i);
  expect(screen.queryByText(/一致する受付を確認できませんでした/)).not.toBeInTheDocument();
});
test('prepare network failure and broken JSON keep Japanese copy and the receipt',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('通信できませんでした');
  expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
  mockFetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token < in JSON');}});
  fireEvent.click(screen.getByRole('button',{name:'この申込の店舗情報を確認'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('この申込を引き継げません'));
  expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument();
  expect(screen.getByText(receipt.facility_name)).toBeInTheDocument();expect(mockPush).not.toHaveBeenCalled();
});
test('list reload network failure also stays Japanese',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  mockFetch.mockRejectedValueOnce(new TypeError('Load failed'));
  fireEvent.click(screen.getByRole('button',{name:'先頭から再確認'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('通信できませんでした');
  expect(screen.queryByText(/Load failed/)).not.toBeInTheDocument();
});
test('arriving from a lost registration handoff asks the owner to choose the application',async()=>{
  mockSearch=new URLSearchParams({from:'handoff'});render(<RecoverRegistrationPage/>);
  expect(await screen.findByText('申込を選んでください')).toBeVisible();
  await screen.findByText(receipt.facility_name);
  expect(screen.getByRole('button',{name:'この申込の店舗情報を確認'})).toBeEnabled();
  expect(mockPush).not.toHaveBeenCalled();
});
test('direct visits do not show the handoff notice',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  expect(screen.queryByText('申込を選んでください')).not.toBeInTheDocument();
});
test('receipt numbers are shown as a short readable reference with the full id for support',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  expect(screen.getByTestId('receipt-short')).toHaveTextContent(/^B100-0000$/);
  expect(screen.getByTestId('receipt-full')).toHaveTextContent(receiptId);
});
test('the page does not render a second main landmark inside the layout one (axe landmark-no-duplicate-main)',async()=>{
  const {container}=render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  expect(container.querySelector('main')).toBeNull();
});
test('secondary actions are drawn as the shared secondary Button (visibly pressable, not bare text)',async()=>{
  render(<RecoverRegistrationPage/>);await screen.findByText(receipt.facility_name);
  const recheck=screen.getByRole('button',{name:'先頭から再確認'});
  expect(recheck).toHaveAttribute('type','button');
  expect(recheck).toHaveClass(...buttonClassName({variant:'secondary'}).split(' '));
  expect(screen.getByRole('button',{name:'この申込の店舗情報を確認'})).toHaveClass(...buttonClassName({variant:'primary'}).split(' '));
});
