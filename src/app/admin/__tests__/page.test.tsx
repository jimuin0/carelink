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
 * コミットされない。DOM には描画せず、AdminDashboard({ searchParams: Promise.resolve({}) }) が返す React 要素ツリーを
 * そのまま辿って検査する（実描画に依存しない・軽量）。
 */
import AdminDashboard from '../page';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(),
}));

const FACILITY_ID = '71000000-0000-4000-8000-000000000001';

/** 任意のメソッドチェーンを許容し、最後に .single() または直接 await で解決する thenable モック。 */
function chain(result: { data?: unknown; count?: number | null; error?: unknown } = {}) {
  const obj: Record<string, unknown> = {};
  const passthrough = ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'or', 'not', 'order', 'limit'];
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
function mockSupabase(opts: {
  prefecture: string | null; city: string | null; status?: string; scheduleError?: unknown; address?: string; stall?: 'kpi' | 'recent';
  businessHours?: unknown; staffIds?: string[]; scheduledStaffIds?: string[]; catchCopy?: string; slug?: string | null;
  bookingRows?: { booking_date: string }[];
}) {
  const staffIds = opts.staffIds ?? ['staff-1'];
  const scheduledStaffIds = opts.scheduledStaffIds ?? staffIds;
  const from = jest.fn((table: string) => {
    if (table === 'facility_members') return chain({ data: [{ facility_id: FACILITY_ID, facility_profiles: { name: 'テスト店舗' } }] });
    if (table === 'facility_menus') return chain({ count: 1 });
    // 在籍スタッフを勤務の有無つきで読む（workingStaffQuery）。勤務日を保存した人だけ staff_schedules に行がある。
    if (table === 'staff_profiles') {
      return chain({
        data: staffIds.map(id => ({ id, staff_schedules: scheduledStaffIds.includes(id) ? [{ day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' }] : [], schedule_overrides: [] })),
        error: opts.scheduleError,
      });
    }
    if (table === 'facility_photos') return chain({ count: 1 });
    if (table === 'facility_profiles') {
      return chain({ data: { status: opts.status ?? 'draft', name: 'テスト店舗', slug: opts.slug === undefined ? 'test-shop' : opts.slug, address: opts.address ?? 'テスト住所', prefecture: opts.prefecture, city: opts.city, business_hours: opts.businessHours ?? null, catch_copy: opts.catchCopy ?? null, description: null } });
    }
    if (table === 'bookings') {
      const bookings = chain({ data: opts.bookingRows ?? [], count: 0 });
      // Chainable but never settles, like a transport that accepted the request and went silent.
      const stalled: Record<string, unknown> = { then: () => undefined };
      for (const m of ['eq', 'neq', 'gte', 'lte']) stalled[m] = () => stalled;
      if (opts.stall === 'kpi') bookings.eq = jest.fn(() => stalled);
      if (opts.stall === 'recent') bookings.limit = jest.fn(() => stalled);
      return bookings;
    }
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
    // children 以外の props に渡した要素（ページ見出しの actions など）も辿る
    for (const [key, value] of Object.entries(el.props)) {
      if (key !== 'children' && value && typeof value === 'object' && 'props' in (value as object)) findElementsWithDirectText(value, text, results);
    }
  }
  return results;
}

/** オンボーディング・チェックリストの「基本情報（住所）」リンクを1つだけ見つける（空振り防止）。 */
function findBasicInfoLink(root: AnyNode) {
  const matches = findElementsWithDirectText(root, '基本情報（住所）');
  expect(matches).toHaveLength(1);
  return matches[0];
}

test('別の店舗の申込は元の受付情報を共有しない新しいタブで開く', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const links = findElementsWithDirectText(root, '別の店舗を申し込む（新しいタブ）');
  expect(links).toHaveLength(1);
  expect(links[0].props).toMatchObject({ href: '/register', target: '_blank', rel: 'noopener noreferrer' });
});

test('(viii-a) prefecture と city が両方揃っていれば「基本情報」は完了扱い（line-through）', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).toContain('line-through');
});

test('(viii-b) prefecture のみ欠ければ「基本情報」は未完了のまま', async () => {
  mockSupabase({ prefecture: null, city: '渋谷区' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).not.toContain('line-through');
});

test('(viii-c) city のみ欠ければ「基本情報」は未完了のまま', async () => {
  mockSupabase({ prefecture: '東京都', city: null });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const link = findBasicInfoLink(root);
  expect(String(link.props.className)).not.toContain('line-through');
});

test('(viii-d) href は /admin/settings へ導く', async () => {
  mockSupabase({ prefecture: null, city: null });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const link = findBasicInfoLink(root);
  expect(link.props.href).toBe(`/admin/settings?facility_id=${FACILITY_ID}`);
});

test('住所が空なら基本情報を完了扱いにしない', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', address: '　' });
  expect(String(findBasicInfoLink(await AdminDashboard({ searchParams: Promise.resolve({}) })).props.className)).not.toContain('line-through');
});

test('掲載済みでも未確認営業時間はネット予約準備中として説明する', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。ネット予約は準備中で、電話・店舗への問い合わせをご案内します。')).toHaveLength(1);
  expect(findElementsWithDirectText(root, '無料掲載を公開')).toHaveLength(1);
  expect(findElementsWithDirectText(root, '営業時間の入力・保存')).toHaveLength(1);
});

// ─── E8: スタッフを追加しただけでは勤務は作られない ─────────────────────────────
// 以前は追加と同時に DB が「毎日 09:00〜19:00」を黙って作り、行が1つでもあれば完了扱いにしていた。
const CONFIRMED_HOURS = {
  mon: { open: '10:00', close: '20:00' }, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' },
  thu: { open: '10:00', close: '20:00' }, fri: { open: '10:00', close: '20:00' }, sat: { open: '10:00', close: '20:00' }, sun: null,
};
function staffStepLink(root: AnyNode) {
  const matches = findElementsWithDirectText(root, 'スタッフ登録と勤務時間の保存');
  expect(matches).toHaveLength(1);
  return matches[0];
}
/** 要素ツリーの文字（文字列・数値）を順に連結する。 */
function textOf(node: AnyNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: AnyNode } }).props.children);
  return '';
}

// 「勤務スケジュール設定」は「スタッフ登録と勤務時間の保存」と同じ作業の二重掲載だった。1項目にまとめ、
// 予約を受けないスタッフがいることは補足で知らせる（そのスタッフのせいで永久に未完了にはしない）。
test('勤務時間を保存していない有効スタッフがいれば、スタッフの項目に人数を補足する（他に勤務する人がいれば完了）', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'draft', businessHours: CONFIRMED_HOURS,
    staffIds: ['staff-1', 'staff-2'], scheduledStaffIds: ['staff-1'] });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const link = staffStepLink(root);
  expect(String(link.props.className)).toContain('line-through');
  expect(textOf(link)).toContain('スタッフ登録と勤務時間の保存（勤務時間が未登録か営業時間外で予約を受けられないスタッフ：1人）');
  expect(findElementsWithDirectText(root, '予約枠：勤務スケジュール設定')).toHaveLength(0);
});

test('公開中で有効スタッフ全員が勤務時間を保存していれば、すべて完了でチェックリストを閉じる', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published', businessHours: CONFIRMED_HOURS, catchCopy: '駅チカ3分' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(findElementsWithDirectText(root, '店舗セットアップ')).toHaveLength(0);
});

test('公開中で誰も勤務時間を保存していなければ、予約枠が出ないことを案内する', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published', businessHours: CONFIRMED_HOURS, scheduledStaffIds: [] });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。予約枠を表示するにはスタッフの勤務スケジュールを設定してください。')).toHaveLength(1);
  expect(String(staffStepLink(root).props.className)).not.toContain('line-through');
});

test('在籍スタッフ全員に勤務時間が無ければ「スタッフ登録と勤務時間の保存」も未完了（予約を受けられる人がいない）', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published', businessHours: CONFIRMED_HOURS, scheduledStaffIds: [] });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(String(staffStepLink(root).props.className)).not.toContain('line-through');
  // 足りないのは勤務時間だけなので、一般的な「準備中」ではなくスタッフの画面へ導く
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。ネット予約は準備中で、電話・店舗への問い合わせをご案内します。')).toHaveLength(0);
});

test('勤務時間のほかにも足りない項目があれば、一般的な「準備中」の案内にする', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published', scheduledStaffIds: [] });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。ネット予約は準備中で、電話・店舗への問い合わせをご案内します。')).toHaveLength(1);
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。予約枠を表示するにはスタッフの勤務スケジュールを設定してください。')).toHaveLength(0);
});

test('在籍スタッフがいなければ、勤務時間ではなく一般的な「準備中」の案内にする', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published', businessHours: CONFIRMED_HOURS, staffIds: [] });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  expect(findElementsWithDirectText(root, '無料掲載は公開中です。ネット予約は準備中で、電話・店舗への問い合わせをご案内します。')).toHaveLength(1);
});

test('公開ゲートに止められる PR 文言は「表現」の項目として未完了で示す', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', catchCopy: '地域No.1' });
  const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
  const matches = findElementsWithDirectText(root, '基本情報（キャッチコピー・施設紹介の表現）');
  expect(matches).toHaveLength(1);
  expect(String(matches[0].props.className)).not.toContain('line-through');
});

test('勤務スケジュールの読取失敗は未設定0件へ置換しない', async () => {
  mockSupabase({ prefecture: '東京都', city: '渋谷区', scheduleError: { message: 'failed' } });
  await expect(AdminDashboard({ searchParams: Promise.resolve({}) })).rejects.toThrow('店舗セットアップの状況を取得できませんでした: failed');
});

describe('止まった読取を「読み込み中」のまま放置しない', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('KPI の読取が止まれば期限で例外にし、error.tsx の再読み込みへ渡す', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区', stall: 'kpi' });
    const result = AdminDashboard({ searchParams: Promise.resolve({}) }).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(8000);
    expect(await result).toMatchObject({ name: 'PageReadTimeoutError', label: 'dashboard-bookings-today' });
    expect(console.error).toHaveBeenCalledWith('[page-read] timeout', { label: 'dashboard-bookings-today', ms: 8000 });
  });

  test('最近の予約カードだけが止まってもページは落とさず、カード内でエラーを示す', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区', stall: 'recent' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    const recent: { type: (props: unknown) => Promise<unknown>; props: unknown }[] = [];
    (function walk(node: AnyNode) {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const el = node as { type?: { name?: string }; props?: { children?: AnyNode } };
      if (el.type?.name === 'RecentBookings') recent.push(el as never);
      if (el.props) flattenChildren(el.props.children).forEach(walk);
    })(root);
    expect(recent).toHaveLength(1);
    const card = recent[0].type(recent[0].props);
    await jest.advanceTimersByTimeAsync(8000);
    expect(findElementsWithDirectText(await card, '予約の取得に失敗しました。ページを再読み込みしてください。')).toHaveLength(1);
  });
});

// ─── 初回ログインから公開までの導線（2026年10月23日） ───────────────────────────
/** props が条件を満たす要素を集める。 */
function findElements(node: AnyNode, match: (props: Record<string, unknown>) => boolean, results: { props: Record<string, unknown> }[] = []) {
  if (node === null || typeof node !== 'object') return results;
  if (Array.isArray(node)) { node.forEach(n => findElements(n, match, results)); return results; }
  const el = node as { props?: Record<string, unknown> };
  if (el.props) {
    if (match(el.props)) results.push(el as { props: Record<string, unknown> });
    flattenChildren(el.props.children).forEach(k => findElements(k, match, results));
    for (const [key, value] of Object.entries(el.props)) {
      if (key !== 'children' && value && typeof value === 'object' && 'props' in (value as object)) findElements(value, match, results);
    }
  }
  return results;
}
/** 要素ツリー上で text を直接持つ要素が最初に現れる順番（深さ優先）。 */
function orderOf(root: AnyNode, texts: string[]): string[] {
  const seen: string[] = [];
  (function walk(node: AnyNode) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const el = node as { props?: Record<string, unknown> };
    if (!el.props) return;
    for (const kid of flattenChildren(el.props.children)) {
      if (typeof kid === 'string' && texts.includes(kid) && !seen.includes(kid)) seen.push(kid);
      walk(kid);
    }
  })(root);
  return seen;
}

describe('公開前の店舗のダッシュボード', () => {
  test('セットアップを空の数字より先に出し、予約の無い非公開店舗には ¥0 の KPI と2週間表を出さない', async () => {
    mockSupabase({ prefecture: null, city: null });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    expect(orderOf(root, ['店舗セットアップ', '本日のスケジュール'])).toEqual(['店舗セットアップ', '本日のスケジュール']);
    expect(findElements(root, props => props.label === '本日の売上')).toHaveLength(0);
    expect(findElements(root, props => props.title === '予約状況（2週間）')).toHaveLength(0);
  });

  test('非公開でも予約の実績がある店舗では数字を隠さない', async () => {
    mockSupabase({ prefecture: null, city: null, bookingRows: [{ booking_date: '2026-10-23' }] });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    expect(findElements(root, props => props.label === '本日の売上')).toHaveLength(1);
    expect(findElements(root, props => props.title === '予約状況（2週間）')).toHaveLength(1);
  });

  test('公開中の店舗では数字を出す', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    expect(findElements(root, props => props.label === '本日の売上')).toHaveLength(1);
  });

  test('「無料掲載に必要」と「ネット予約に必要（任意）」を別々の進み具合で見せる', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    expect(findElementsWithDirectText(root, '無料掲載に必要')).toHaveLength(1);
    expect(findElementsWithDirectText(root, 'ネット予約に必要（任意）')).toHaveLength(1);
    // 掲載：住所・表現は済み、営業時間と公開がまだ（2/4）。ネット予約：メニュー・写真・スタッフは済み（3/3）。
    // 営業時間は 2026年10月23日の神原さん決定で「無料掲載に必要」へ移った。
    expect(textOf(root)).toContain('2/4 完了');
    expect(textOf(root)).toContain('3/3 完了');
    const [listing] = findElements(root, props => props['aria-label'] === '無料掲載に必要');
    expect(findElementsWithDirectText(listing, '営業時間の入力・保存')).toHaveLength(1);
  });

  test('キャッチコピー・施設紹介が空なら完了（取り消し線）ではなく任意・未入力として見せる', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    const [link] = findElementsWithDirectText(root, '基本情報（キャッチコピー・施設紹介の表現）');
    expect(String(link.props.className)).not.toContain('line-through');
    expect(textOf(link)).toContain('任意・未入力');
  });
});

describe('公開中の店舗のダッシュボード', () => {
  test('ネット予約の準備中の案内は赤い警告（role=alert）ではなく案内（role=status）で出す', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    expect(findElements(root, props => props.role === 'alert')).toHaveLength(0);
    const [status] = findElements(root, props => props.role === 'status');
    expect(textOf(status)).toContain('ネット予約は準備中');
    expect(String(status.props.className)).not.toContain('red');
    // 設定画面の「ネット予約の準備状況」へ直接案内する
    expect(findElements(status, props => props.href === `/admin/settings?facility_id=${FACILITY_ID}#booking-readiness`)).toHaveLength(1);
  });

  test('「掲載ページを見る」で公開ページへ行ける', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区', status: 'published' });
    const root = await AdminDashboard({ searchParams: Promise.resolve({}) });
    const [link] = findElementsWithDirectText(root, '掲載ページを見る');
    expect(link.props.href).toBe('/facility/test-shop');
  });

  test('非公開の店舗には「掲載ページを見る」を出さない', async () => {
    mockSupabase({ prefecture: '東京都', city: '渋谷区' });
    expect(findElementsWithDirectText(await AdminDashboard({ searchParams: Promise.resolve({}) }), '掲載ページを見る')).toHaveLength(0);
  });
});
