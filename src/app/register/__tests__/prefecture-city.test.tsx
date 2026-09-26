/**
 * @jest-environment jsdom
 *
 * /register ページ: zipcloud 応答から prefecture / city が保持され、/api/salons への
 * 送信ボディに含まれることの回帰テスト（2026年8月20日）。
 *
 * 【背景】facility_profiles.prefecture は /search の地域絞り込み・「近くの施設」
 * 「似ている施設」の結合キーだが、セルフサーブ経路は salons に構造化された都道府県/市区町村
 * 列が無く構造的に必ず null になっていた。/register は郵便番号から zipcloud を引いて
 * address1（都道府県）・address2（市区町村）・address3 を受け取っているのに、連結して1本の
 * 文字列にした時点で構造を捨てていたため、入力欄を増やさずに構造を保持する（このテストが守る）。
 */
import '@testing-library/jest-dom';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import RegisterPage from '@/app/register/page';

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// このページは送信前に getRecaptchaToken を呼ぶ（symptoms/page.test.tsx 等と同じ既知の地雷）。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
}));

afterEach(() => {
  jest.restoreAllMocks();
  pushMock.mockClear();
});

function fillStep1AndAdvance() {
  fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: 'テスト施設' } });
  fireEvent.change(screen.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
  fireEvent.change(screen.getByLabelText(/^代表者名/), { target: { value: '山田太郎' } });
  fireEvent.change(screen.getByLabelText(/^担当者名/), { target: { value: '山田花子' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '090-1234-5678' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
}

function checkAllConsents() {
  screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb));
}

function mockFetchWithZipcloud() {
  return jest.fn((url: string) => {
    if (url.startsWith('https://zipcloud.ibsnet.co.jp')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ address1: '大阪府', address2: '堺市堺区', address3: '' }],
          }),
      } as Response);
    }
    if (url === '/api/salons') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, id: '11111111-1111-1111-1111-111111111111' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
}

async function submitAndGetSalonBody(fetchMock: jest.Mock) {
  await screen.findByRole('textbox', { name: /^PR文/ });
  checkAllConsents();
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));

  const dialog = await screen.findByRole('dialog');
  act(() => {
    fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
  });

  await waitFor(() => expect(pushMock).toHaveBeenCalled());
  const [, options] = fetchMock.mock.calls.find(([url]) => url === '/api/salons')!;
  return JSON.parse((options as RequestInit).body as string);
}

test('郵便番号から住所を自動補完すると、prefecture / city が送信ボディに保持される（表示は連結済み address のまま）', async () => {
  const fetchMock = mockFetchWithZipcloud();
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RegisterPage />);
  fillStep1AndAdvance();

  await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(screen.getByLabelText(/^郵便番号/), { target: { value: '5900001' } });

  // 表示用の連結済み address が従来どおり自動入力される（見た目は変えない）。
  await waitFor(() => {
    expect(screen.getByLabelText('住所')).toHaveValue('大阪府堺市堺区');
  });

  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  const body = await submitAndGetSalonBody(fetchMock);
  expect(body.address).toBe('大阪府堺市堺区');
  expect(body.prefecture).toBe('大阪府');
  expect(body.city).toBe('堺市堺区');
});

test('郵便番号を使わず住所を直接書いた場合、送信時に address から prefecture / city が復元される', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url === '/api/salons') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, id: '11111111-1111-1111-1111-111111111111' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RegisterPage />);
  fillStep1AndAdvance();

  await screen.findByLabelText(/^郵便番号/);
  // 郵便番号は入れず、住所欄だけ直接書く（zipcloud は一度も呼ばれない）。
  fireEvent.change(screen.getByLabelText('住所'), { target: { value: '大阪府堺市堺区1-2-3' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  const body = await submitAndGetSalonBody(fetchMock);
  expect(body.address).toBe('大阪府堺市堺区1-2-3');
  expect(body.prefecture).toBe('大阪府');
  expect(body.city).toBe('堺市');
  // zipcloud を一度も叩いていないことの確認（空振り防止）。
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://zipcloud'))).toBe(false);
});

test('住所欄が空のまま送信すると、prefecture / city は null のまま送られる（推測で埋めない）', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url === '/api/salons') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, id: '11111111-1111-1111-1111-111111111111' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RegisterPage />);
  fillStep1AndAdvance();

  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  const body = await submitAndGetSalonBody(fetchMock);
  expect(body.address).toBeNull();
  expect(body.prefecture).toBeNull();
  expect(body.city).toBeNull();
});

function deferredPostal() {
  const pending: Array<(response: Response) => void> = [];
  const fetchMock = jest.fn((url: string) => url.startsWith('https://zipcloud')
    ? new Promise<Response>(resolve => pending.push(resolve))
    : Promise.resolve({ ok: true, json: async () => ({ success: true, id: '11111111-1111-1111-1111-111111111111' }) } as Response));
  global.fetch = fetchMock as unknown as typeof fetch;
  const reply = async (index: number, data: unknown, ok = true) => {
    await act(async () => pending[index]({ ok, json: async () => data } as Response));
  };
  return { fetchMock, pending, reply };
}
const osaka = { results: [{ address1: '大阪府', address2: '堺市堺区', address3: '合成町' }] };
const aichi = { results: [{ address1: '愛知県', address2: '西尾市', address3: '合成町' }] };

test('old postal responses cannot overwrite a newer postcode and region', async () => {
  const { fetchMock, pending, reply } = deferredPostal();
  render(<RegisterPage />); fillStep1AndAdvance();
  const postal = await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(postal, { target: { value: '5900001' } });
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(postal, { target: { value: '4450001' } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await reply(1, aichi); await reply(0, osaka);
  expect(screen.getByLabelText('住所')).toHaveValue('愛知県西尾市合成町');
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(await submitAndGetSalonBody(fetchMock)).toMatchObject({ prefecture: '愛知県', city: '西尾市' });
});

test('shortening the postcode invalidates an in-flight response', async () => {
  const { pending, reply } = deferredPostal();
  render(<RegisterPage />); fillStep1AndAdvance();
  const postal = await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(postal, { target: { value: '5900001' } });
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(postal, { target: { value: '590' } });
  await reply(0, osaka);
  expect(screen.getByLabelText('住所')).toHaveValue('');
});

test('manual address correction invalidates a pending lookup and old hidden region', async () => {
  const { fetchMock, pending, reply } = deferredPostal();
  render(<RegisterPage />); fillStep1AndAdvance();
  const postal = await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(postal, { target: { value: '5900001' } });
  await waitFor(() => expect(pending).toHaveLength(1));
  await reply(0, osaka);
  fireEvent.change(postal, { target: { value: '5900002' } });
  await waitFor(() => expect(pending).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('住所'), { target: { value: '愛知県西尾市合成町' } });
  await reply(1, osaka);
  expect(screen.getByLabelText('住所')).toHaveValue('愛知県西尾市合成町');
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(await submitAndGetSalonBody(fetchMock)).toMatchObject({ prefecture: '愛知県', city: '西尾市' });
});

test('clearing an autocompleted address must not retain its hidden region', async () => {
  const { fetchMock, pending, reply } = deferredPostal();
  render(<RegisterPage />); fillStep1AndAdvance();
  fireEvent.change(await screen.findByLabelText(/^郵便番号/), { target: { value: '5900001' } });
  await waitFor(() => expect(pending).toHaveLength(1)); await reply(0, osaka);
  fireEvent.change(screen.getByLabelText('住所'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(await submitAndGetSalonBody(fetchMock)).toMatchObject({ address: null, prefecture: null, city: null });
});

test.each([
  { ok: false, data: osaka },
  { ok: true, data: { results: [{ address1: {}, address2: '堺市', address3: '' }] } },
  { ok: true, data: null },
])('invalid postal response preserves manual input (%#)', async ({ ok, data }) => {
  const { pending, reply } = deferredPostal();
  render(<RegisterPage />); fillStep1AndAdvance();
  const postal = await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(screen.getByLabelText('住所'), { target: { value: '愛知県西尾市合成町' } });
  fireEvent.change(postal, { target: { value: '5900001' } });
  await waitFor(() => expect(pending).toHaveLength(1)); await reply(0, data, ok);
  expect(screen.getByLabelText('住所')).toHaveValue('愛知県西尾市合成町');
});

test.each(['network', 'json'])('postal %s failure leaves typed input available', async (failure) => {
  global.fetch = jest.fn(() => failure === 'network'
    ? Promise.reject(new Error('synthetic network failure'))
    : Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('synthetic malformed JSON'); } } as Response));
  render(<RegisterPage />); fillStep1AndAdvance();
  const postal = await screen.findByLabelText(/^郵便番号/);
  fireEvent.change(screen.getByLabelText('住所'), { target: { value: '愛知県西尾市合成町' } });
  await act(async () => { fireEvent.change(postal, { target: { value: '5900001' } }); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('住所')).toHaveValue('愛知県西尾市合成町');
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(await screen.findByRole('textbox', { name: /^PR文/ })).toBeVisible();
});
