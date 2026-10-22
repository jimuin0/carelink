/**
 * @jest-environment jsdom
 *
 * 口コミへの返信の公開・編集・削除（2026年10月22日）。
 * 【神原さん決定】SALON BOARD と同じく、投稿した返信を後から編集・削除できる。
 * 以前はブラウザから review_replies へ直接 INSERT するだけで、投稿後は直せず消せず、
 * もう一度「返信」を押すと必ず「返信に失敗しました」になった。
 * 書き込みはすべて /api/admin/review-replies を通す（権限と文字数は API と DB が確かめる）。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminReviewsPage from '../page';

const A = '75000000-0000-4000-8000-000000000001';
const R1 = '75000000-0000-4000-8000-000000000011';
const R2 = '75000000-0000-4000-8000-000000000012';
const R3 = '75000000-0000-4000-8000-000000000013';
const P1 = '75000000-0000-4000-8000-000000000021';
const P2 = '75000000-0000-4000-8000-000000000022';
const P3 = '75000000-0000-4000-8000-000000000023';
const P4 = '75000000-0000-4000-8000-000000000024';

const mockFrom = jest.fn();
const mockFetch = jest.fn();
let replyRows: { id: string; review_id: string; content: string; created_at: string | null }[] = [];
let reviews: Record<string, unknown>[] = [];

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ facility_id: A }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/admin-facility-selection', () => ({
  loadAdminFacilitySelection: () => Promise.resolve({ choices: [{ id: A, name: '合成店舗A' }], selectedId: A }),
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'owner-1' } } }) },
    from: (table: string) => mockFrom(table),
  }),
}));

const baseReviews = [
  { id: R1, facility_id: A, reviewer_name: '返信済みのお客様', rating: 5, comment: 'とても良かったです', status: 'published', created_at: '2026-10-01T00:00:00Z' },
  { id: R2, facility_id: A, reviewer_name: '未返信のお客様', rating: 4, comment: null, status: 'published', created_at: '2026-10-02T00:00:00Z' },
];
const hiddenReview = { id: R3, facility_id: A, reviewer_name: '非表示のお客様', rating: 2, comment: '残念でした', status: 'hidden', created_at: '2026-10-03T00:00:00Z' };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  replyRows = [{ id: P1, review_id: R1, content: '既存の返信です', created_at: '2026-10-03T00:00:00Z' }];
  reviews = baseReviews;
  mockFrom.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'facility_reviews' ? reviews : replyRows, error: null });
    return chain;
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

async function card(name: string) {
  return within(await screen.findByRole('article', { name: `${name}さんの口コミ` }));
}

test('返信がある口コミは本文と「編集」「削除」を出し、入力欄は出さない（2 件目の返信を作らせない）', async () => {
  render(<AdminReviewsPage />);
  const replied = await card('返信済みのお客様');
  expect(replied.getByText('既存の返信です')).toBeInTheDocument();
  expect(replied.getByRole('button', { name: '編集' })).toBeInTheDocument();
  expect(replied.getByRole('button', { name: '削除' })).toBeInTheDocument();
  expect(replied.queryByRole('textbox')).not.toBeInTheDocument();
  expect(replied.queryByRole('button', { name: '返信' })).not.toBeInTheDocument();

  const unreplied = await card('未返信のお客様');
  const input = unreplied.getByRole('textbox', { name: '口コミへの返信' });
  expect(input).toHaveAttribute('maxLength', '500');
  expect(unreplied.getByRole('button', { name: '返信' })).toBeDisabled();
  expect(unreplied.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
});

describe('公開', () => {
  test('「返信」は公開の確認を出し、キャンセルなら送らない', async () => {
    render(<AdminReviewsPage />);
    const unreplied = await card('未返信のお客様');
    fireEvent.change(unreplied.getByRole('textbox', { name: '口コミへの返信' }), { target: { value: 'ありがとうございます' } });
    fireEvent.click(unreplied.getByRole('button', { name: '返信' }));
    const dialog = await screen.findByRole('dialog', { name: '返信を公開' });
    expect(within(dialog).getByText('返信は店舗ページに公開されます。')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(unreplied.getByRole('textbox', { name: '口コミへの返信' })).toHaveValue('ありがとうございます');
  });

  test('確認後に API へ送り、公開した返信を「編集」「削除」つきで表示する', async () => {
    mockFetch.mockReturnValue(json(201, { reply: { id: P2, review_id: R2, content: 'ありがとうございます', created_at: '2026-10-22T00:00:00Z' } }));
    render(<AdminReviewsPage />);
    const unreplied = await card('未返信のお客様');
    fireEvent.change(unreplied.getByRole('textbox', { name: '口コミへの返信' }), { target: { value: '  ありがとうございます  ' } });
    fireEvent.click(unreplied.getByRole('button', { name: '返信' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を公開' })).getByRole('button', { name: '公開する' }));

    expect(await screen.findByRole('status')).toHaveTextContent('返信を公開しました');
    expect(mockFetch).toHaveBeenCalledWith(`/api/admin/review-replies?facility_id=${A}`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ review_id: R2, content: 'ありがとうございます' }),
    }));
    expect(unreplied.getByText('ありがとうございます')).toBeInTheDocument();
    expect(unreplied.getByRole('button', { name: '編集' })).toBeInTheDocument();
    expect(unreplied.queryByRole('textbox')).not.toBeInTheDocument();
    // ブラウザから review_replies へ直接書かない
    expect(mockFrom.mock.calls.filter(([t]) => t === 'review_replies')).toHaveLength(1);
  });

  test('他の管理者が先に返信していた（409）ときは理由を出し、今の返信を読み直す', async () => {
    mockFetch.mockReturnValue(json(409, { error: 'この口コミには既に返信があります。画面を再読み込みしてください' }));
    render(<AdminReviewsPage />);
    const unreplied = await card('未返信のお客様');
    fireEvent.change(unreplied.getByRole('textbox', { name: '口コミへの返信' }), { target: { value: '重複' } });
    fireEvent.click(unreplied.getByRole('button', { name: '返信' }));
    replyRows = [...replyRows, { id: P2, review_id: R2, content: '別の管理者の返信', created_at: null }];
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を公開' })).getByRole('button', { name: '公開する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('この口コミには既に返信があります。画面を再読み込みしてください');
    expect(await unreplied.findByText('別の管理者の返信')).toBeInTheDocument();
  });

  test('409 で読み直した後、その返信が消えても古い書きかけは戻ってこない（見えない下書きを残さない）', async () => {
    mockFetch
      .mockReturnValueOnce(json(409, { error: 'この口コミには既に返信があります。画面を再読み込みしてください' }))
      .mockReturnValueOnce(json(200, { ok: true, replyId: P2 }));
    render(<AdminReviewsPage />);
    const unreplied = await card('未返信のお客様');
    fireEvent.change(unreplied.getByRole('textbox', { name: '口コミへの返信' }), { target: { value: '古い書きかけ' } });
    fireEvent.click(unreplied.getByRole('button', { name: '返信' }));
    replyRows = [...replyRows, { id: P2, review_id: R2, content: '別の管理者の返信', created_at: null }];
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を公開' })).getByRole('button', { name: '公開する' }));
    expect(await unreplied.findByText('別の管理者の返信')).toBeInTheDocument();

    fireEvent.click(unreplied.getByRole('button', { name: '削除' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を削除' })).getByRole('button', { name: '削除する' }));
    expect(await screen.findByRole('status')).toHaveTextContent('返信を削除しました');
    expect(mockFetch).toHaveBeenLastCalledWith(`/api/admin/review-replies/${P2}?facility_id=${A}`, { method: 'DELETE' });
    expect(unreplied.getByRole('textbox', { name: '口コミへの返信' })).toHaveValue('');
    expect(unreplied.getByRole('button', { name: '返信' })).toBeDisabled();
  });

  test('通信できなければ「返信を公開できませんでした」で、入力は残す', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    render(<AdminReviewsPage />);
    const unreplied = await card('未返信のお客様');
    fireEvent.change(unreplied.getByRole('textbox', { name: '口コミへの返信' }), { target: { value: '届かない返信' } });
    fireEvent.click(unreplied.getByRole('button', { name: '返信' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を公開' })).getByRole('button', { name: '公開する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('返信を公開できませんでした');
    expect(unreplied.getByRole('textbox', { name: '口コミへの返信' })).toHaveValue('届かない返信');
  });
});

describe('編集', () => {
  test('その場で編集し、保存すると API へ送って表示を更新する（変更が無ければ保存できない）', async () => {
    mockFetch.mockReturnValue(json(200, { reply: { id: P1, review_id: R1, content: '修正した返信です', created_at: '2026-10-03T00:00:00Z' } }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    const editor = replied.getByRole('textbox', { name: '返信を編集' });
    expect(editor).toHaveValue('既存の返信です');
    expect(editor).toHaveAttribute('maxLength', '500');
    expect(replied.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: ' 修正した返信です ' } });
    fireEvent.click(replied.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('status')).toHaveTextContent('返信を更新しました');
    expect(mockFetch).toHaveBeenCalledWith(`/api/admin/review-replies/${P1}?facility_id=${A}`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ content: '修正した返信です' }),
    }));
    expect(replied.getByText('修正した返信です')).toBeInTheDocument();
    expect(replied.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('キャンセルなら送らずに元の返信に戻す', async () => {
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    fireEvent.change(replied.getByRole('textbox', { name: '返信を編集' }), { target: { value: '書きかけ' } });
    fireEvent.click(replied.getByRole('button', { name: 'キャンセル' }));
    expect(replied.getByText('既存の返信です')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('失敗したら API の理由を出し、編集中の本文を残す', async () => {
    mockFetch.mockReturnValue(json(403, { error: '店舗の管理権限を確認してください' }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    fireEvent.change(replied.getByRole('textbox', { name: '返信を編集' }), { target: { value: '直したい返信' } });
    fireEvent.click(replied.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('店舗の管理権限を確認してください');
    expect(replied.getByRole('textbox', { name: '返信を編集' })).toHaveValue('直したい返信');
  });

  test('応答に理由が無い失敗は既定の文言を出す', async () => {
    mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    fireEvent.change(replied.getByRole('textbox', { name: '返信を編集' }), { target: { value: '直したい返信' } });
    fireEvent.click(replied.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('返信を更新できませんでした');
  });

  test('保存が 404（他の管理者が先に削除した）なら編集をやめ、他の口コミの「編集」が押せるままになる', async () => {
    replyRows = [...replyRows, { id: P2, review_id: R2, content: '二件目の返信です', created_at: null }];
    mockFetch.mockReturnValue(json(404, { error: 'この返信は見つかりません。画面を再読み込みしてください' }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    const other = await card('未返信のお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    expect(other.getByRole('button', { name: '編集' })).toBeDisabled(); // 編集は 1 件ずつ
    fireEvent.change(replied.getByRole('textbox', { name: '返信を編集' }), { target: { value: '間に合わなかった修正' } });
    replyRows = replyRows.filter((r) => r.id !== P1);
    fireEvent.click(replied.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('この返信は見つかりません。画面を再読み込みしてください');
    expect(await replied.findByRole('textbox', { name: '口コミへの返信' })).toHaveValue('');
    expect(replied.queryByRole('textbox', { name: '返信を編集' })).not.toBeInTheDocument();
    expect(other.getByRole('button', { name: '編集' })).toBeEnabled();
  });

  test('読み直したら別の返信に置き換わっていた（削除して投稿し直された）ときは、古い本文で上書きさせない', async () => {
    mockFetch.mockReturnValue(json(404, { error: 'この返信は見つかりません。画面を再読み込みしてください' }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '編集' }));
    fireEvent.change(replied.getByRole('textbox', { name: '返信を編集' }), { target: { value: '古い返信への修正' } });
    replyRows = [{ id: P4, review_id: R1, content: '投稿し直された返信', created_at: '2026-10-22T00:00:00Z' }];
    fireEvent.click(replied.getByRole('button', { name: '保存' }));

    expect(await replied.findByText('投稿し直された返信')).toBeInTheDocument();
    expect(replied.queryByRole('textbox')).not.toBeInTheDocument();
    expect(replied.getByRole('button', { name: '編集' })).toBeEnabled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('削除', () => {
  test('確認を出し、削除すると返信が消えて入力欄に戻る', async () => {
    mockFetch.mockReturnValue(json(200, { ok: true, replyId: P1 }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '削除' }));
    const dialog = await screen.findByRole('dialog', { name: '返信を削除' });
    expect(within(dialog).getByText('この返信を削除しますか？店舗ページからも消えます。')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '削除する' }));

    expect(await screen.findByRole('status')).toHaveTextContent('返信を削除しました');
    expect(mockFetch).toHaveBeenCalledWith(`/api/admin/review-replies/${P1}?facility_id=${A}`, { method: 'DELETE' });
    expect(replied.queryByText('既存の返信です')).not.toBeInTheDocument();
    expect(replied.getByRole('textbox', { name: '口コミへの返信' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('「削除する」を押した時点で確認を閉じる（送信中に「キャンセル」できるように見せない）', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '削除' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を削除' })).getByRole('button', { name: '削除する' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(replied.getByRole('button', { name: '削除' })).toBeDisabled();
    expect(replied.getByRole('button', { name: '編集' })).toBeDisabled();

    finish({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, replyId: P1 }) });
    expect(await screen.findByRole('status')).toHaveTextContent('返信を削除しました');
    expect(replied.queryByText('既存の返信です')).not.toBeInTheDocument();
  });

  test('キャンセルなら送らない', async () => {
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '削除' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を削除' })).getByRole('button', { name: 'キャンセル' }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(replied.getByText('既存の返信です')).toBeInTheDocument();
  });

  test('通信できなければ返信を残したまま「返信を削除できませんでした」', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '削除' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を削除' })).getByRole('button', { name: '削除する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('返信を削除できませんでした');
    expect(replied.getByText('既存の返信です')).toBeInTheDocument();
  });

  test('既に消えていた（404）なら理由を出して読み直し、今の状態（返信なし）に合わせる', async () => {
    mockFetch.mockReturnValue(json(404, { error: 'この返信は見つかりません。画面を再読み込みしてください' }));
    render(<AdminReviewsPage />);
    const replied = await card('返信済みのお客様');
    fireEvent.click(replied.getByRole('button', { name: '削除' }));
    replyRows = [];
    fireEvent.click(within(await screen.findByRole('dialog', { name: '返信を削除' })).getByRole('button', { name: '削除する' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('この返信は見つかりません。画面を再読み込みしてください');
    await waitFor(() => expect(replied.queryByText('既存の返信です')).not.toBeInTheDocument());
  });
});

describe('非表示の口コミ', () => {
  test('不透明度で薄くしない（返信の文字・ボタンのコントラストを落とさない）。非表示は地色・破線とバッジで示す', async () => {
    reviews = [...baseReviews, hiddenReview];
    replyRows = [...replyRows, { id: P3, review_id: R3, content: '非表示の口コミへの返信', created_at: null }];
    render(<AdminReviewsPage />);
    const article = await screen.findByRole('article', { name: '非表示のお客様さんの口コミ' });
    const hidden = within(article);
    expect(hidden.getByText('非表示')).toBeInTheDocument();
    expect(hidden.getByRole('button', { name: '編集' })).toBeEnabled();
    expect(article.className).not.toMatch(/\bopacity-/);
    expect(article).toHaveClass('border-dashed');
    for (let el: HTMLElement | null = hidden.getByText('非表示の口コミへの返信'); el && el !== article; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)opacity-/);
    }
  });
});
