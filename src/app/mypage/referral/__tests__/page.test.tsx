/**
 * @jest-environment jsdom
 *
 * 紹介プログラムページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「コード未発行・0人」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ReferralPage from '@/app/mypage/referral/page';

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

test('取得失敗(500) → エラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<ReferralPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('招待情報の取得に失敗しました');
});

test('取得成功 → 通常表示しエラーは出さない（正常系不変）', async () => {
  mockFetch(true, { code: 'ABC123', used_count: 2, already_referred: false });
  render(<ReferralPage />);
  expect(await screen.findByText('友達招待プログラム')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('clipboard denial cannot claim referral code was copied',async()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:jest.fn().mockRejectedValue(new Error('Synthetic denial'))}});mockFetch(true,{code:'ABC123',used_count:2,already_referred:false});render(<ReferralPage/>);fireEvent.click(await screen.findByRole('button',{name:'コピー',exact:true}));expect(await screen.findByRole('alert')).toHaveTextContent('コピーできませんでした');expect(screen.queryByText('コピー済み')).toBeNull();});

const INPUT = '例: ABCD2345';
const LINK_HINT = '紹介リンクのコードを入力しました。内容をご確認のうえ「適用」を押してください。';

describe('共有リンク（?ref=）のコードを入力欄へ入れる', () => {
  afterEach(() => { window.history.pushState({}, '', '/'); });

  test('友達のリンクから来たら、コードを入力欄へ入れて確認を促す（自動では適用しない）', async () => {
    window.history.pushState({}, '', '/mypage/referral?ref=wxyz2345');
    mockFetch(true, { code: 'ABCD2345', used_count: 0, already_referred: false });
    render(<ReferralPage />);
    expect(await screen.findByPlaceholderText(INPUT)).toHaveValue('WXYZ2345');
    expect(screen.getByText(LINK_HINT)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1); // GET のみ。適用（POST）はしない
  });

  test('入力欄を書き換えたら、リンクから入れた旨の案内は消す', async () => {
    window.history.pushState({}, '', '/mypage/referral?ref=WXYZ2345');
    mockFetch(true, { code: 'ABCD2345', used_count: 0, already_referred: false });
    render(<ReferralPage />);
    fireEvent.change(await screen.findByPlaceholderText(INPUT), { target: { value: 'efgh2345' } });
    expect(screen.getByPlaceholderText(INPUT)).toHaveValue('EFGH2345');
    expect(screen.queryByText(LINK_HINT)).toBeNull();
  });

  test.each([
    ['自分のコードのリンク', 'ABCD2345'],
    ['コードの形でない値', 'abc'],
  ])('%sは入力欄へ入れない', async (_label, ref) => {
    window.history.pushState({}, '', `/mypage/referral?ref=${ref}`);
    mockFetch(true, { code: 'ABCD2345', used_count: 0, already_referred: false });
    render(<ReferralPage />);
    expect(await screen.findByPlaceholderText(INPUT)).toHaveValue('');
    expect(screen.queryByText(LINK_HINT)).toBeNull();
  });

  test('適用済みの方には入力欄を出さない', async () => {
    window.history.pushState({}, '', '/mypage/referral?ref=WXYZ2345');
    mockFetch(true, { code: 'ABCD2345', used_count: 0, already_referred: true });
    render(<ReferralPage />);
    expect(await screen.findByText('紹介コード適用済みです')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(INPUT)).toBeNull();
  });

  test('適用に成功したら入力欄と案内を閉じる', async () => {
    window.history.pushState({}, '', '/mypage/referral?ref=WXYZ2345');
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ code: 'ABCD2345', used_count: 0, already_referred: false }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, message: '紹介コードを適用しました。初回のご予約完了で300ポイントが付与されます。' }) }) as unknown as typeof fetch;
    render(<ReferralPage />);
    await screen.findByText(LINK_HINT);
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    expect(await screen.findByText('紹介コード適用済みです')).toBeInTheDocument();
    expect(screen.queryByText(LINK_HINT)).toBeNull();
    expect(global.fetch).toHaveBeenLastCalledWith('/api/referral', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'WXYZ2345' }) }));
  });
});

test('来店済みで断られたら、理由をそのまま伝えて「付与されます」とは言わない', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ code: 'ABCD2345', used_count: 0, already_referred: false }) })
    .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: '紹介コードは初回のご来店前の方のみご利用いただけます。' }) }) as unknown as typeof fetch;
  render(<ReferralPage />);
  fireEvent.change(await screen.findByPlaceholderText(INPUT), { target: { value: 'WXYZ2345' } });
  fireEvent.click(screen.getByRole('button', { name: '適用' }));
  expect(await screen.findByText('紹介コードは初回のご来店前の方のみご利用いただけます。')).toBeInTheDocument();
  expect(screen.queryByText('紹介コード適用済みです')).toBeNull();
  expect(screen.queryByText(/ポイントが付与されます/)).toBeNull();
});

test('入力は初回のご予約の前に、と完了取り消し時の扱いを案内する', async () => {
  mockFetch(true, { code: 'ABCD2345', used_count: 0, already_referred: false });
  render(<ReferralPage />);
  expect(await screen.findByText('友達から紹介コードをもらったら、初回のご予約の前に入力してください。初回のご予約完了で300ポイントをプレゼントします。')).toBeInTheDocument();
  expect(screen.getByText('※紹介コードは初回のご来店前の方のみご利用いただけます。')).toBeInTheDocument();
  expect(screen.getByText('※ご予約の完了が取り消された場合（無断キャンセルへの訂正など）は、紹介のポイントも取り消されます。')).toBeInTheDocument();
});
