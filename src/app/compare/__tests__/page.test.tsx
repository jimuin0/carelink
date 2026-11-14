/**
 * @jest-environment node
 *
 * 監査 A185: ?ids=abc を問い合わせに渡すと PostgREST が 22P02 を返し、DB 障害と同じく 404 に化けていた。
 * メニュー価格の取得失敗も無視され、価格帯が「-」と表示されていた。
 */
import ComparePage from '../page';

const mockIn = jest.fn();
let facilityResult: { data: unknown; error: unknown };
let menuResult: { data: unknown; error: unknown };
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'not', 'or', 'order']) chain[m] = () => chain;
      chain.in = (...args: unknown[]) => { mockIn(table, ...args); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(table === 'facility_profiles' ? facilityResult : menuResult).then(resolve);
      return chain;
    },
  }),
}));

const ID = '0c000000-0000-4000-8000-000000000001';
const props = (ids: string) => ({ searchParams: Promise.resolve({ ids }) });

beforeEach(() => {
  mockIn.mockReset();
  facilityResult = { data: [{ id: ID, name: '合成施設', slug: 'synthetic', business_type: '美容室', prefecture: '大阪府', city: '豊中市' }], error: null };
  menuResult = { data: [{ facility_id: ID, price: 3000 }], error: null };
});

test('UUID でない ids は問い合わせに渡さず、選択を促す画面を出す', async () => {
  const page = await ComparePage(props('abc,def'));
  expect(mockIn).not.toHaveBeenCalled();
  expect(JSON.stringify(page)).toContain('比較する施設を選んでください');
});

test('施設の取得失敗は 404 にせず例外にする（error.tsx に委ねる）', async () => {
  facilityResult = { data: null, error: { code: '57014', message: 'timeout' } };
  await expect(ComparePage(props(ID))).rejects.toThrow('COMPARE_FACILITIES_UNAVAILABLE');
});

test('メニュー価格の取得失敗を「価格未登録」と偽らず例外にする', async () => {
  menuResult = { data: null, error: { message: 'timeout' } };
  await expect(ComparePage(props(ID))).rejects.toThrow('COMPARE_MENU_PRICES_UNAVAILABLE');
});

test('有効な UUID だけを問い合わせに渡す', async () => {
  await ComparePage(props(`abc,${ID}`));
  expect(mockIn).toHaveBeenCalledWith('facility_profiles', 'id', [ID]);
});

test('公開施設が無ければ 404', async () => {
  facilityResult = { data: [], error: null };
  await expect(ComparePage(props(ID))).rejects.toThrow('NEXT_NOT_FOUND');
});
