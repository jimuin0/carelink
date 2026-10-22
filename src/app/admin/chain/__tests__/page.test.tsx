import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
const A = '22222222-2222-4222-8222-222222222221', B = '22222222-2222-4222-8222-222222222222';
const mockUser = jest.fn(), mockMembers = jest.fn(), mockFacilities = jest.fn(), mockRpc = jest.fn(), mockReviews = jest.fn();
const reviewQueries: { method: string; args: unknown[] }[] = [];
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => ({
  auth: { getUser: mockUser }, from: () => { const c = { select: () => c, eq: () => c, in: mockMembers }; return c; },
}) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mockRpc,
  from: (table: string) => {
    if (table === 'facility_reviews') {
      const r: Record<string, unknown> = { range: mockReviews };
      for (const method of ['select', 'eq', 'in', 'order']) r[method] = (...args: unknown[]) => { reviewQueries.push({ method, args }); return r; };
      return r;
    }
    const c = { select: () => c, in: () => c, order: mockFacilities }; return c;
  },
}) }));
jest.mock('next/navigation', () => ({ redirect: jest.fn(() => { throw new Error('redirect'); }) }));
jest.mock('../BulkActions', () => ({ __esModule: true, default: () => null }));
import Page from '../page';
const statistics = [{ id: A, booking_count: 1001, monthly_bookings: 1000, review_count: 0, rating_avg: 0, nps_score: null },
  { id: B, booking_count: 1, monthly_bookings: 1, review_count: 1, rating_avg: 4, nps_score: -50 }];
beforeEach(() => {
  jest.clearAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: A } }, error: null });
  mockMembers.mockResolvedValue({ data: [{ facility_id: A }, { facility_id: B }], error: null });
  mockFacilities.mockResolvedValue({ data: [A,B].map((id,i) => ({ id, name: `店舗${i}`, slug: `synthetic-${i}`,
    prefecture: null, city: null, status: i ? 'draft' : 'published' })), error: null });
  mockRpc.mockResolvedValue({ data: statistics, error: null });
  reviewQueries.length = 0;
  mockReviews.mockResolvedValue({ data: [], error: null });
});
const text = (html: HTMLElement) => html.textContent ?? '';
test('full aggregate counts and selected facility links render without scanning bookings', async () => {
  render(await Page()); expect(screen.getByText('1,002')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗1' })).toHaveAttribute('href', `/admin?fid=${B}`);
  expect(mockRpc).toHaveBeenCalledWith('get_chain_statistics', expect.objectContaining({ p_actor_id: A, p_facility_ids: [A,B] }));
});
test.each([null, { id: A }])('invalid authentication fails closed %j', async user => {
  mockUser.mockResolvedValue({ data: { user }, error: user ? {} : null });
  await expect(Page()).rejects.toThrow('redirect'); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([{ data: null,error:{} },{ data:null },{ data:Array(101).fill({ facility_id:A }) }])('invalid memberships %j do not become an empty chain', async value => {
  mockMembers.mockResolvedValue(value); await expect(Page()).rejects.toThrow('管理店舗'); expect(mockRpc).not.toHaveBeenCalled();
});
test('one facility is genuinely not a chain', async () => {
  mockMembers.mockResolvedValue({ data:[{ facility_id:A }] }); render(await Page());
  expect(screen.getByText(/複数の施設を管理/)).toBeInTheDocument(); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null, [], [statistics[0],statistics[0]], [statistics[0],{ ...statistics[1],id:'33333333-3333-4333-8333-333333333333' }],
  [{ ...statistics[0],booking_count:-1 },statistics[1]]])('missing, foreign or invalid statistic %j cannot become measured zero', async data => {
  mockRpc.mockResolvedValue({ data }); await expect(Page()).rejects.toThrow('店舗別集計');
});
test.each(['rpc','facilities','missing-facility','wrong-facility'])('failed %s observation cannot render partial statistics', async kind => {
  if (kind === 'rpc') mockRpc.mockResolvedValue({ data:statistics,error:{} });
  else mockFacilities.mockResolvedValue(kind === 'facilities' ? { error:{} } : { data: kind === 'missing-facility' ? [] :
    [{ id:A },{ id:'33333333-3333-4333-8333-333333333333' }] });
  await expect(Page()).rejects.toThrow();
});

// NPS は回答の経路がどこにも無く、列が常に「—」だった（2026年10月22日）。公開中の口コミの
// 総合・項目別評価に置き換えた（神原さん決定「ホットペッパーみたいな評価の付け方にしたら？」）。
describe('口コミ評価（旧 NPS 列）', () => {
  const axes = (skill: number, service: number, atmosphere: number, cleanliness: number, explanation: number) => ({
    rating_skill: skill, rating_service: service, rating_atmosphere: atmosphere, rating_cleanliness: cleanliness, rating_explanation: explanation,
  });
  test('店舗ごとに総合と 5 項目の平均を出し、口コミの無い店舗は「まだ口コミがありません」', async () => {
    mockReviews.mockResolvedValue({ data: [
      { facility_id: B, rating: 5, ...axes(5, 4, 5, 5, 3) },
      { facility_id: B, rating: 4, ...axes(4, 4, 3, 5, 4) },
    ], error: null });
    const { container } = render(await Page());
    expect(screen.queryByText('NPS')).toBeNull();
    expect(screen.getByText('項目別評価')).toBeInTheDocument();
    const rows = [...container.querySelectorAll('tbody tr')];
    const rowA = rows.find((row) => text(row as HTMLElement).includes('店舗0'))!;
    const rowB = rows.find((row) => text(row as HTMLElement).includes('店舗1'))!;
    expect(text(rowA as HTMLElement)).toContain('まだ口コミがありません');
    expect(text(rowB as HTMLElement)).toContain('★4.5');
    expect(text(rowB as HTMLElement)).toContain('技術4.5接客4.0雰囲気4.0清潔感5.0施術の説明3.5');
    // 総口コミ数は公開中の口コミの合計
    expect(text(container)).toContain('総口コミ数2公開中');
  });
  test('公開中かつ非表示フラグの無い口コミだけを、管理している店舗に絞って読む', async () => {
    render(await Page());
    expect(reviewQueries).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['status', 'published'] },
      { method: 'eq', args: ['is_flagged', false] },
      { method: 'in', args: ['facility_id', [A, B]] },
    ]));
  });
  test('口コミの読み取りに失敗したら「口コミ 0 件」を出さずにエラーにする', async () => {
    mockReviews.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(Page()).rejects.toThrow('店舗別集計');
  });
});
