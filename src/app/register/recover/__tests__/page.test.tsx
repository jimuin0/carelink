import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RecoverRegistrationPage from '../page';
import { SALON_RECOVERY_CONTEXT_KEY, SALON_RECOVERY_ONBOARDING_PATH } from '@/lib/salon-browser-context';
const mockPush=jest.fn(), mockReplace=jest.fn();
const mockRouter={push:mockPush,replace:mockReplace};
jest.mock('next/navigation',()=>({useRouter:()=>mockRouter}));
const mockFetch=jest.fn();
const receiptId='b1000000-0000-4000-8000-000000000001';
const recoveryId='b2000000-0000-4000-8000-000000000001';
const receipt={receipt_id:receiptId,facility_name:'Synthetic recovery branch',business_type:'ヘアサロン',created_at:null};
const ready={state:'ready',receipts:[receipt],next:null};
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body});
beforeEach(()=>{jest.resetAllMocks();window.sessionStorage.clear();global.fetch=mockFetch;
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
test.each([403,500])('failed list is not shown as zero receipts (%s)',async status=>{
  mockFetch.mockResolvedValue(response({},status));render(<RecoverRegistrationPage/>);
  await screen.findByRole('alert');expect(screen.queryByText(/一致する受付を確認できませんでした/)).not.toBeInTheDocument();
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
