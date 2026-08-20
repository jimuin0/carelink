/**
 * @jest-environment node
 *
 * /admin のオンボーディング・チェックリストに「基本情報（住所）」項目が正しく反映されるかの検査。
 *
 * 背景: facility_profiles.prefecture/city はセルフサーブ経路（/api/facility/setup ←
 * /admin/onboarding）では構造的に null になり得る（このディレクトリの背景は
 * src/lib/japan-address.ts と src/lib/facility-publish-gate.ts を参照）。
 * チェックリストに項目が無いと、店舗オーナーが未設定に気づけないまま公開してしまい、
 * 「公開されているのに地域で探すと出てこない」まま発覚が遅れる。
 *
 * done の判定は facility_profiles.prefecture と city が【両方】埋まっているかで行う
 * （片方だけでは /search の絞り込みに正しく乗らない）。
 *
 * ⚠️ AdminDashboard はサーバーコンポーネントで、内部にネストした非同期コンポーネント
 * （RecentBookings）を持つため、@testing-library/react の render() で DOM 描画すると
 * React 18 のクライアントレンダラは非同期関数コンポーネントを扱えず sus­pend したまま
 * コミットされない。DOM には描画せず、AdminDashboard() が返す React 要素ツリーを
 * そのまま辿って検査する（実描画に依存しない・軽量）。
 */
import AdminDashboard from '../page';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(),
}));

const FACILITY_ID = 'facility-1';

/** 任意のメソッドチェーンを許容し、最後に .single() または直接 await で解決する thenable モック。 */
function chain(result: { data?: unknown; count?: number | null; error?: unknown } = {}) {
  const obj: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit'];
  for (const m of passthrough) obj[m] = jest.fn(() => obj);
  obj.single = jest.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  obj.then = (resolve: (v: { data: unknown; count: number | null; error: unknown }) => unknown) =>
    resolve({ data: result.data ?? [], count: result.count ?? null, error: result.error ?? null });
  return obj;
}

/**
 * facility_profiles の prefecture/city を差し替えられる最小限の supabase モック。
 * bookings 系は KPI 表示に使うだけで本検査の対象外のため、常に空/0 を返す。
 */
function mockSupabase(opts: { prefecture: string | null; city: string | null }) {
  const from = jest.fn((table: string) => {
    if (table === 'facility_members') return chain({ data: { facility_id: FACILITY_ID } });
    if (table === 'facility_menus') return chain({ count: 1 });
    if (table === 'staff_profiles') return chain({ data: [{ id: 'staff-1' }] });
    if (table === 'facility_photos') return chain({ count: 1 });
    if (table === 'facility_profiles') {
      return chain({ data: { status: 'draft', prefecture: opts.prefecture, city: opts.city } });
    }
    if (table === 'staff_schedules') return chain({ count: 1 });
    if (table === 'bookings') return chain({ data: [], count: 0 });
    throw new Error('unexpected table: ' + table);
  });

  (createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    from,
  });
}

// ─── React 要素ツリーを実描画せずに辿るための最小ウォーカー ────────────────────

type AnyNode = unknown;

function flattenChildren(children: AnyNode): AnyNode[] {
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  if (children === null || children === undefined || children === false) return [];
  return [children];
}

/** children に text を直接の文字列として含む要素（props を持つオブジェクト）を再帰的に集める。 */
function findElementsWithDirectText(node: AnyNode, text: string, results: { props: Record<string, unknown> }[] = []) {
  if (node === null || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    for (const n of node) findElementsWithDirectText(n, text, results);
    return results;
  }
  const el = node as { props?: Record<string, unknown> };
  if (el.props) {
    const kids = flattenChildren(el.props.children);
    if (kids.includes(text)) {
      results.push(el as { props: Record<string, unknown> });
    }
    for (const k of kids) findElementsWithDirectText(k, text, results);
  }
  return results;
}

/** オンボーディング・チェックリストの「基本情報（住所）」リンクを1つだけ見つける（空振り防止）。 */
function findBasicInfoLink(root: AnyNode) {
  const matches = findElementsWithDirectText(root, '基本情報（住所）');
  expect(matches).toHaveLength(1);
  return matches[0];
}

test('(viii-a) prefecture と city が両方揃っていれば「基本情報」は完了扱い（line-through）', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区' });
  const root = await AdminDashboard();
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).toContain('line-through');
});

test('(viii-b) prefecture のみ欠ければ「基本情報」は未完了のまま', async () => {
  mockSupabase({ prefecture: null, city: '渋谷区' });
  const root = await AdminDashboard();
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).not.toContain('line-through');
});

test('(viii-c) city のみ欠ければ「基本情報」は未完了のまま', async () => {
  mockSupabase({ prefecture: '東京都', city: null });
  const root = await AdminDashboard();
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).not.toContain('line-through');
});

test('(viii-d) href は /admin/settings へ導く', async () => {
  mockSupabase({ prefecture: null, city: null });
  const root = await AdminDashboard();
  const link = findBasicInfoLink(root);
  expect(link.props.href).toBe('/admin/settings');
});
