/** @jest-environment node */
/**
 * 利用状況分析（/admin/usage-stats）の「口コミ評価」カード（2026年10月22日）。
 *
 * 回帰の中身: 以前は「NPS スコア」カードが nps_surveys を集計していたが、来院者が NPS に答える
 * 画面・メール・LIFF がどこにも無く、ずっと「まだデータがありません」のままだった。
 * 神原さん決定（「ホットペッパーみたいな評価の付け方にしたら？」）により、公開中の口コミの
 * 総合と 5 項目の平均に置き換えた。集計そのものは src/lib/__tests__/review-rating-summary.test.ts。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import UsageStatsPage from '../usage-stats/page';

const FACILITY = 'ab170000-0000-4000-8000-000000000001';
const mockFrom = jest.fn();
const reads: { table: string; calls: [string, unknown[]][] }[] = [];
let mockReviews: unknown[] = [];
let mockReviewError: unknown = null;

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    from: mockFrom,
  }),
}));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom }) }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

function query(table: string) {
  const read = { table, calls: [] as [string, unknown[]][] };
  reads.push(read);
  const data = table === 'facility_members' ? [{ facility_id: FACILITY, facility_profiles: { name: '合成店舗' } }]
    : table === 'facility_reviews' ? mockReviews : [];
  const error = table === 'facility_reviews' ? mockReviewError : null;
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) {
    q[method] = (...args: unknown[]) => { read.calls.push([method, args]); return q; };
  }
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: error ? null : data, error }).then(resolve, reject);
  return q;
}

async function renderText() {
  const html = renderToStaticMarkup(await UsageStatsPage({ searchParams: Promise.resolve({}) }));
  return html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');
}

const axes = (skill: number | null, service: number | null, atmosphere: number | null, cleanliness: number | null, explanation: number | null) => ({
  rating_skill: skill, rating_service: service, rating_atmosphere: atmosphere, rating_cleanliness: cleanliness, rating_explanation: explanation,
});

beforeEach(() => {
  mockFrom.mockReset().mockImplementation(query);
  reads.length = 0;
  mockReviews = [];
  mockReviewError = null;
});

test('NPS カードは出さず、口コミが無いときは「まだ口コミがありません」', async () => {
  const text = await renderText();
  expect(text).not.toContain('NPS');
  expect(text).toContain('口コミ評価まだ口コミがありません');
  expect(reads.some((read) => read.table === 'nps_surveys')).toBe(false);
});

test('総合と 5 項目（技術・接客・雰囲気・清潔感・施術の説明）の平均を出す', async () => {
  mockReviews = [
    { facility_id: FACILITY, rating: 5, ...axes(5, 5, 4, 5, 4) },
    { facility_id: FACILITY, rating: 4, ...axes(4, 3, 4, 5, null) }, // 説明を付けていない口コミはその項目の母数に入れない
  ];
  const text = await renderText();
  expect(text).toContain('口コミ評価総合★4.5（2件）');
  expect(text).toContain('技術4.5接客4.0雰囲気4.0清潔感5.0施術の説明4.0');
  expect(text).toContain('公開中の口コミ（全期間）の平均です。');
});

test('選んだ店舗の、公開中かつ非表示フラグの無い口コミだけを読む', async () => {
  await renderText();
  const review = reads.find((read) => read.table === 'facility_reviews');
  expect(review?.calls).toEqual(expect.arrayContaining([
    ['eq', ['status', 'published']],
    ['eq', ['is_flagged', false]],
    ['eq', ['facility_id', FACILITY]],
    ['range', [0, 999]],
  ]));
});

test('口コミの読み取りに失敗したら「まだ口コミがありません」と偽らずエラーにする', async () => {
  mockReviewError = { code: '08006', message: 'private-db-diagnostic' };
  await expect(renderText()).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
});

test('評価が無い・薄い文字にならない（白地で AA の gray-500 以上）', async () => {
  const html = renderToStaticMarkup(await UsageStatsPage({ searchParams: Promise.resolve({}) }));
  const empty = html.match(/<p class="([^"]*)">まだ口コミがありません<\/p>/)?.[1];
  expect(empty?.split(' ')).toContain('text-gray-500');
});
