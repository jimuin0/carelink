/**
 * @jest-environment jsdom
 *
 * 設定ページの連携状態取得失敗可視化 回帰テスト。
 * 旧実装は .catch で connected:false / lineLinked:false に化けさせ、障害を「未連携」と誤表示していた。
 * 連携を操作するページのため、エラーと未連携を区別する。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SettingsPage from '@/app/mypage/settings/page';

jest.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }));

function routeFetch(handler: (url: string) => { ok: boolean; status: number; body: object }) {
  global.fetch = jest.fn((url: string) => {
    const { ok, status, body } = handler(url);
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const originalChannelId=process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
const originalLiffId = process.env.NEXT_PUBLIC_LIFF_ID;

afterEach(() => {
  jest.clearAllMocks();
  if(originalChannelId===undefined)delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;else process.env.NEXT_PUBLIC_LINE_CHANNEL_ID=originalChannelId;
  if (originalLiffId === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = originalLiffId;
});

/**
 * 【2026年7月29日】LINE はローンチ段階で設定しない方針になり、LIFF 未設定の間は
 * LINE 連携セクションを丸ごと出さないようにした（lib/line-availability.ts）。
 * そのため「取得失敗時のエラー表示」も LIFF の有無で本数が変わる。
 * 隠したこと自体が意図どおりであることと、LIFF を入れれば元に戻ることの両方を固定する。
 */
test('LIFF 未設定 → LINE セクションごと出さない（取得失敗のエラーも gcal のみ）', async () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  routeFetch(() => ({ ok: false, status: 500, body: {} }));
  render(<SettingsPage />);
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.filter((a) => a.textContent?.includes('連携状態を取得できませんでした'))).toHaveLength(1);
  expect(screen.queryByText('LINE連携')).not.toBeInTheDocument();
});

test('LIFF 設定済み → 取得失敗を「未連携」でなくエラーとして明示する（gcal/line とも・回帰防止）', async () => {
  process.env.NEXT_PUBLIC_LIFF_ID = '1234567890-abcdefgh';
  routeFetch(() => ({ ok: false, status: 500, body: {} }));
  render(<SettingsPage />);
  const alerts = await screen.findAllByRole('alert');
  // gcal と LINE の2セクションでそれぞれエラー表示
  expect(alerts.filter((a) => a.textContent?.includes('連携状態を取得できませんでした'))).toHaveLength(2);
});

// LIFF を外しても、既に連携している人からは解除手段を奪わない。
// ここが崩れると、連携済みの顧客が自分で連携を切れなくなる。
test('LIFF 未設定でも連携済みなら LINE セクションを出す（解除手段を残す）', async () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  routeFetch((url) =>
    url === '/api/google-calendar'
      ? { ok: true, status: 200, body: { connected: false } }
      : { ok: true, status: 200, body: { linked: true } },
  );
  render(<SettingsPage />);
  expect(await screen.findByText('LINEと連携中')).toBeInTheDocument();
  expect(screen.getByText('連携を解除する')).toBeInTheDocument();
});

test('取得成功 → 連携状態を正しく表示しエラーは出さない（正常系不変）', async () => {
  process.env.NEXT_PUBLIC_LIFF_ID = '1234567890-abcdefgh';
  routeFetch((url) =>
    url === '/api/google-calendar'
      ? { ok: true, status: 200, body: { connected: true } }
      : { ok: true, status: 200, body: { linked: true } },
  );
  render(<SettingsPage />);
  // LINE 連携済み（一意テキスト）が表示され、どのセクションもエラーを出さない
  expect(await screen.findByText('LINEと連携中')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // gcal も「連携する」ボタン（未連携UI）でなく連携済みUIになっている
  expect(screen.queryByText('Googleカレンダーと連携する')).not.toBeInTheDocument();
});

test('configured account reconfirmation uses explicit local OAuth linking mode',async()=>{
 process.env.NEXT_PUBLIC_LIFF_ID='synthetic-liff';process.env.NEXT_PUBLIC_LINE_CHANNEL_ID='synthetic-channel';
 routeFetch(()=>({ok:true,status:200,body:{linked:true,connected:false}}));render(<SettingsPage/>);
 const button=await screen.findByRole('button',{name:'LINE連携を再確認'});const form=button.closest('form')!;
 expect(form).toHaveAttribute('action','/api/auth/line');expect(form).toHaveAttribute('method','get');expect(form.querySelector('input[name="mode"]')).toHaveAttribute('value','link');expect(form.querySelector('input[name="redirect"]')).toHaveAttribute('value','/mypage/settings');
});

// 未連携の人の入口。以前は「LINE連携はLINEアプリのリッチメニューから行えます」と案内していたが、リッチメニューの
// 各画面は未連携だとこの設定ページへ案内するため、行き来するだけで連携できなかった（2026年10月23日）。
test('未連携 → 「LINEと連携する」で連携を始められ、リッチメニューへ戻す案内は出さない',async()=>{
 process.env.NEXT_PUBLIC_LIFF_ID='synthetic-liff';process.env.NEXT_PUBLIC_LINE_CHANNEL_ID='synthetic-channel';
 routeFetch(()=>({ok:true,status:200,body:{linked:false,connected:false}}));render(<SettingsPage/>);
 const button=await screen.findByRole('button',{name:'LINEと連携する'});const form=button.closest('form')!;
 expect(form).toHaveAttribute('action','/api/auth/line');expect(form.querySelector('input[name="mode"]')).toHaveAttribute('value','link');
 expect(form.querySelector('input[name="redirect"]')).toHaveAttribute('value','/mypage/settings');
 expect(screen.queryByText(/リッチメニュー/)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'LINE連携を再確認'})).not.toBeInTheDocument();
});
test('LINE ログイン未設定 → 連携ボタンを出さず、受付停止を伝える（リッチメニューへは戻さない）',async()=>{
 process.env.NEXT_PUBLIC_LIFF_ID='synthetic-liff';delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
 routeFetch(()=>({ok:true,status:200,body:{linked:false,connected:false}}));render(<SettingsPage/>);
 expect(await screen.findByText('現在、LINE連携の受付を停止しています。')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'LINEと連携する'})).not.toBeInTheDocument();
 expect(screen.queryByText(/リッチメニュー/)).not.toBeInTheDocument();
});

// E21: 予約完了画面のバナーを閉じた・登録が消えた・別の端末から切り替えたいお客様が、登録し直せる入口。
describe('この端末のプッシュ通知（お客様の登録・解除の入口）', () => {
 const originalVapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
 afterEach(() => { if (originalVapid === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = originalVapid; });
 test('Push を送れる環境では、通知設定の中に端末の登録欄を出す（見出しはページの階層に合わせて h3）', async () => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'synthetic-vapid';
  routeFetch(() => ({ ok: true, status: 200, body: { linked: false, connected: false } }));
  render(<SettingsPage />);
  expect(await screen.findByRole('heading', { level: 3, name: 'この端末のプッシュ通知' })).toBeInTheDocument();
 });
 test('Push を送れない環境（VAPID 未設定）では出さない', async () => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  routeFetch(() => ({ ok: true, status: 200, body: { linked: false, connected: false } }));
  render(<SettingsPage />);
  await screen.findByText('通知設定');
  expect(screen.queryByText('この端末のプッシュ通知')).not.toBeInTheDocument();
 });
});
