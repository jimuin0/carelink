/**
 * @jest-environment jsdom
 *
 * 投稿した口コミ（マイページ）と編集画面（2026年10月23日）。
 * - 店舗に投稿者のアカウント ID を見せないため、facility_reviews.user_id の閲覧権限をブラウザのロールから外した
 *   （migration 20261023120100）。以前の画面は .eq('user_id', …) と select('*') で読んでいたので、
 *   適用後は読み込みエラーになる。本人の口コミは /api/review/mine から読む。
 * - 運営の審査で止められた口コミに理由を出す。以前は status だけを見ており、星だけを直して
 *   非公開になった口コミ（C9）や審査待ちの口コミにも何も出なかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MyReviewsPage from '../page';
import EditReviewPage from '../[id]/edit/page';

const R1 = '79000000-0000-4000-8000-000000000011';
const mockFetch = jest.fn();
const mockBrowserClient = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: R1 }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockBrowserClient() }));
jest.mock('@/components/facility/StarRating', () => ({ __esModule: true, default: ({ value }: { value: number }) => <span>星{value}</span> }));

const mine = (overrides: Record<string, unknown>) => ({
  id: R1, facility_name: '合成サロン', facility_slug: 'synthetic-salon', rating: 4,
  rating_skill: 5, rating_service: 4, rating_atmosphere: null, rating_cleanliness: 3, rating_explanation: 2,
  comment: '日本一です', status: 'published', created_at: '2026-10-02T00:00:00Z', moderation: 'none', ...overrides,
});
function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('投稿した口コミ', () => {
  test.each([
    ['pending', '運営の確認中のため、まだ公開されていません'],
    ['rejected', '運営の判断で非公開になっています'],
    // 承認済みなのに旗が戻ったまま（審査待ちの行が無い）は『確認中』ではなく問い合わせを案内する
    ['stalled', '公開の手続きが止まっています。お手数ですが、運営までお問い合わせください'],
  ])('審査で止められた口コミ（%s）には理由を出す', async (moderation, label) => {
    mockFetch.mockReturnValue(json(200, { reviews: [mine({ moderation })] }));
    render(<MyReviewsPage />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText('(非表示中)')).not.toBeInTheDocument();
  });

  test('本人の口コミは API から読み、ブラウザから facility_reviews を読まない', async () => {
    mockFetch.mockReturnValue(json(200, { reviews: [mine({ status: 'hidden', created_at: null })] }));
    render(<MyReviewsPage />);
    expect(await screen.findByRole('link', { name: '合成サロン' })).toHaveAttribute('href', '/facility/synthetic-salon');
    expect(screen.getByText('(非表示中)')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/review/mine', { cache: 'no-store' });
    expect(mockBrowserClient).not.toHaveBeenCalled();
  });

  test('読めなければ読み込み失敗を出す', async () => {
    mockFetch.mockReturnValue(json(500, { error: 'x' }));
    render(<MyReviewsPage />);
    expect(await screen.findByText('データの読み込みに失敗しました')).toBeInTheDocument();
  });
});

describe('口コミの編集', () => {
  test('本人の 1 件を API から読み、各項目の評価を出す', async () => {
    mockFetch.mockReturnValue(json(200, { reviews: [mine({})] }));
    render(<EditReviewPage />);
    expect(await screen.findByDisplayValue('日本一です')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(`/api/review/mine?id=${R1}`, { cache: 'no-store' });
    // 未入力の項目は総合評価で補う（従来どおり）
    expect(screen.getAllByText(/^星/).map((el) => el.textContent)).toEqual(['星5', '星4', '星4', '星3', '星2']);
    expect(mockBrowserClient).not.toHaveBeenCalled();
  });

  test.each([
    ['見つからない', () => json(404, { error: '口コミが見つかりません' })],
    ['空の応答', () => json(200, { reviews: [] })],
    ['通信の失敗', () => Promise.reject(new Error('offline'))],
  ])('%s ときは読み込み失敗を出す', async (_label, reply) => {
    mockFetch.mockImplementation(reply);
    render(<EditReviewPage />);
    expect(await screen.findByText('データの読み込みに失敗しました')).toBeInTheDocument();
  });
});
