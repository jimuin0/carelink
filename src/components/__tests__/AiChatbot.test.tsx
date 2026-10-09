/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import AiChatbot from '@/components/AiChatbot';
import { getRecaptchaToken, RecaptchaClientError } from '@/lib/recaptcha-client';
import { CLIENT_CLEANUP_COMPLETED_EVENT, CLIENT_CLEANUP_GENERATION_KEY } from '@/lib/client-cleanup-marker';
jest.mock('@/lib/recaptcha-client', () => ({ ...jest.requireActual('@/lib/recaptcha-client'), getRecaptchaToken: jest.fn() }));
beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => { (getRecaptchaToken as jest.Mock).mockResolvedValue('synthetic-token'); });
afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });
function mockFetch(ok: boolean, status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
}
function openAndSendQuickQuestion() {
  fireEvent.click(screen.getByLabelText('AIアシスタントに質問する'));
  fireEvent.click(screen.getByText('近くの鍼灸院を探したい'));
}
test('confirmed reply clears input and sends one bot token', async () => {
  mockFetch(true,200,{reply:'Confirmed reply'}); render(<AiChatbot />); openAndSendQuickQuestion();
  expect(await screen.findByText('Confirmed reply')).toBeVisible();
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('');
  const options=(global.fetch as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(options.body).recaptcha_token).toBe('synthetic-token');
  expect(getRecaptchaToken).toHaveBeenCalledWith('chat');
});
test('a confirmed reply preserves a different question typed while the first request is pending', async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<AiChatbot />); openAndSendQuickQuestion();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText('メッセージを入力...'), { target: { value: '次の未送信の質問' } });
  await act(async () => { finish({ ok: true, status: 200, json: async () => ({ reply: 'First confirmed reply' }) }); });
  expect(await screen.findByText('First confirmed reply')).toBeVisible();
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('次の未送信の質問');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test.each([[429,{}],[503,{}],[200,{reply:''}],[200,{reply:{private:'ignored'}}],[429,{code:'CHAT_GLOBAL_QUOTA_LIMIT'}]])('unconfirmed response keeps input and is not an assistant message (%s)', async(status,body) => {
  mockFetch(status===200,status,body); render(<AiChatbot />); openAndSendQuickQuestion();
  expect(await screen.findByRole('alert')).toHaveTextContent('入力を保持');
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('近くの鍼灸院を探したい');
  expect(screen.queryByText('すみません、うまく回答できませんでした。')).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(1);
});
test('failed bot proof never sends HTTP and retains question', async () => {
  global.fetch=jest.fn(); (getRecaptchaToken as jest.Mock).mockRejectedValue(new RecaptchaClientError());
  render(<AiChatbot />); openAndSendQuickQuestion();
  expect(await screen.findByRole('alert')).toBeVisible(); expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('近くの鍼灸院を探したい');
});
test('transport and malformed JSON retain input without manufacturing history', async () => {
  global.fetch=jest.fn().mockRejectedValue(new Error('private detail must not be shown'));
  render(<AiChatbot />); openAndSendQuickQuestion();
  expect(await screen.findByRole('alert')).toHaveTextContent('通信エラー');
  expect(screen.queryByText('private detail must not be shown')).not.toBeInTheDocument();
  global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:()=>Promise.reject(new Error('bad JSON'))});
  fireEvent.keyDown(screen.getByPlaceholderText('メッセージを入力...'),{key:'Enter'});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('回答を確認できません'));
  const sent=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(sent.messages).toEqual([{role:'user',content:'近くの鍼灸院を探したい'}]);
});
test('rapid quick-question clicks share one in-flight request; dev null token omitted', async () => {
  let finish!: (value: unknown)=>void;
  (getRecaptchaToken as jest.Mock).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  mockFetch(true,200,{reply:'Confirmed'}); render(<AiChatbot />);
  fireEvent.click(screen.getByLabelText('AIアシスタントに質問する'));
  const button=screen.getByText('近くの鍼灸院を探したい');
  fireEvent.click(button);fireEvent.click(button);
  expect(getRecaptchaToken).toHaveBeenCalledTimes(1);
  await act(async()=>{finish(null);}); expect(await screen.findByText('Confirmed')).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).not.toHaveProperty('recaptcha_token');
});
test('browser transport aborts at30s and permits explicit retry without auto-resend', async () => {
  jest.useFakeTimers();
  global.fetch=jest.fn((_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })) as typeof fetch;
  render(<AiChatbot />);openAndSendQuickQuestion();
  await act(async()=>{await Promise.resolve();});
  await act(async()=>{jest.advanceTimersByTime(30000);await Promise.resolve();});
  expect(screen.getByRole('alert')).toHaveTextContent('入力を保持');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('近くの鍼灸院を探したい');
});
test('verified cleanup clears medical input and rejects late token before transport', async () => {
  let finish!: (value: unknown)=>void;
  (getRecaptchaToken as jest.Mock).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  global.fetch=jest.fn(); render(<AiChatbot />); openAndSendQuickQuestion();
  act(()=>window.dispatchEvent(new Event(CLIENT_CLEANUP_COMPLETED_EVENT)));
  await act(async()=>{finish('late-token');});
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('AIアシスタントに質問する'));
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('another-tab cleanup aborts a started request and prevents late response from restoring conversation', async () => {
  let finish!: (value: unknown)=>void;
  global.fetch=jest.fn().mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<AiChatbot />); openAndSendQuickQuestion();
  await act(async()=>{await Promise.resolve();});
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:CLIENT_CLEANUP_GENERATION_KEY,newValue:'synthetic-generation'})));
  await act(async()=>{finish({ok:true,status:200,json:async()=>({reply:'late private answer'})});});
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.click(screen.getByLabelText('AIアシスタントに質問する'));
  expect(screen.queryByText('late private answer')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('メッセージを入力...')).toHaveValue('');
});
