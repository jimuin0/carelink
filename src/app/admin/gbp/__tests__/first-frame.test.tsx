/**
 * @jest-environment jsdom
 *
 * GBP 管理画面のタブ切替を検査する。守っているのは 2 つ。
 *
 * 1. 【最初のフレーム】タブを押した最初の描画が、まだ取得していない結果を見せていないこと。
 *    useEffect はコミット後に走るため、effect のトップレベルに setAuditLoading(true) を
 *    置いても最初のフレームには間に合わない（2026年8月16日に StationSearch で実測した欠陥と同型）。
 *
 * 2. 【誤った原因の断定】「Googleクチコミ」タブは place.reviews を描くのに、旧実装は
 *    audit タブでしか取得していなかった。クチコミタブへ直接来ると auditData が null のまま
 *    「クチコミデータの取得には GOOGLE_MAPS_API_KEY の設定が必要です」と表示され、
 *    鍵が設定済みでも【設定漏れだと誤って断定】していた。取得を試みることを検査で固定する。
 *
 * ⚠️ どちらも async IIFE で包む等の「lint の検出だけ消す」変更では通らない。実 DOM を見ている。
 */
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { clickFirstFrame, mountFirstFrame, type FirstFrameHandle } from '@/test-utils/first-frame';
import AdminGbpPage from '../page';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: jest.fn() }) }));

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const API_KEY_MESSAGE = 'GOOGLE_MAPS_API_KEY';

function mockSupabase() {
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      if (table === 'facility_members') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ facility_id: 'facility-1', facility_profiles: { name: 'Synthetic' } }], error: null }) }) }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { gbp_place_id: 'ChIJtest', gbp_cid: '' }, error: null }),
          }),
        }),
      };
    },
  });
}

/** タブのラベルからボタンを引く。空振り（ラベル変更で検査が無言で無効化）を防ぐため必ず存在を主張する。 */
function tabButton(handle: FirstFrameHandle, label: string): Element {
  const button = Array.from(handle.container.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  );
  expect(button).toBeDefined();
  return button as Element;
}

describe('GBP 管理画面のタブ切替', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockSupabase();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('「Googleクチコミ」タブ: 押した最初のフレームで API キー未設定と断定しない', async () => {
    // 応答を保留させる。解決させると最初のフレームを見たのか完了後を見たのか区別できない。
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle(); // 初回ロード（施設・GBP設定）の完了を待つ

    clickFirstFrame(tabButton(handle, 'Googleクチコミ'));

    expect(handle.text()).not.toContain(API_KEY_MESSAGE);
    expect(handle.container.querySelector('.animate-pulse')).not.toBeNull();

    handle.unmount();
  });

  it('「Googleクチコミ」タブ: 直接開いても取得を試みる（旧実装は診断タブ経由でしか取得しなかった）', async () => {
    const fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();

    clickFirstFrame(tabButton(handle, 'Googleクチコミ'));
    await handle.settle();

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/gbp/place?facility_id=facility-1');

    handle.unmount();
  });

  it('「診断スコア」タブ: 押した最初のフレームからローディングを見せる', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();

    clickFirstFrame(tabButton(handle, '診断スコア'));

    expect(handle.text()).toContain('診断中...');
    expect(handle.container.querySelector('.animate-pulse')).not.toBeNull();

    handle.unmount();
  });

  it('「GBP投稿」タブ: 押した最初のフレームで「投稿がありません」と断定しない', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();

    clickFirstFrame(tabButton(handle, 'GBP投稿'));

    expect(handle.text()).not.toContain('まだ投稿がありません');
    expect(handle.container.querySelector('.animate-pulse')).not.toBeNull();

    handle.unmount();
  });

  it('取得済みのタブを開き直しても再取得しない（同じ結果を二重に取りに行かない）', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ placeData: null, audit: null }) }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();

    clickFirstFrame(tabButton(handle, '診断スコア'));
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'GBP設定'));
    await handle.settle();
    clickFirstFrame(tabButton(handle, '診断スコア'));
    await handle.settle();

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/admin/gbp/place?facility_id=facility-1')).toHaveLength(1);

    handle.unmount();
  });

  // 監査 A81/A82: 取得失敗を「API キー未設定」「投稿0件」と断定しない。
  it('「Googleクチコミ」タブ: 取得失敗を API キー未設定と案内しない', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof global.fetch;
    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'Googleクチコミ'));
    await handle.settle();
    expect(handle.text()).not.toContain(API_KEY_MESSAGE);
    expect(handle.text()).toContain('クチコミデータの取得に失敗しました');
    handle.unmount();
  });

  it('「GBP投稿」タブ: 取得失敗を0件と区別し、0件の成功後は開き直しても再取得しない', async () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'GBP投稿'));
    await handle.settle();
    expect(handle.text()).not.toContain('まだ投稿がありません');
    expect(handle.text()).toContain('投稿の取得に失敗しました');

    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ posts: [] }) }));
    clickFirstFrame(tabButton(handle, 'GBP設定'));
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'GBP投稿'));
    await handle.settle();
    expect(handle.text()).toContain('まだ投稿がありません');
    clickFirstFrame(tabButton(handle, 'GBP設定'));
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'GBP投稿'));
    await handle.settle();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/gbp/posts'))).toHaveLength(2);
    handle.unmount();
  });

  // 監査 A332: GBP を開いただけで投稿済みにしない。通信断ではエラーを出す。
  it('「GBP投稿」タブ: GBPを開くリンクでは PATCH せず、「投稿済みにする」の通信断はエラー表示', async () => {
    const post = { id: 'p1', status: 'draft', post_type: 'STANDARD', title: 'T', body: 'B', created_at: '2026-11-01T00:00:00Z' };
    const fetchMock = jest.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.reject(new Error('offline'));
      if (String(url).startsWith('/api/admin/gbp/posts')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ posts: [post] }) });
      return new Promise(() => {});
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const handle = mountFirstFrame(<AdminGbpPage />);
    await handle.settle();
    clickFirstFrame(tabButton(handle, 'GBP投稿'));
    await handle.settle();
    const link = Array.from(handle.container.querySelectorAll('a')).find((a) => a.textContent?.includes('GBPに投稿'));
    expect(link).toBeDefined();
    link!.addEventListener('click', (e) => e.preventDefault());
    clickFirstFrame(link!);
    await handle.settle();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
    clickFirstFrame(tabButton(handle, '投稿済みにする'));
    await handle.settle();
    expect(handle.text()).toContain('通信エラーが発生しました');
    expect(handle.text()).not.toContain('投稿済み　');
    handle.unmount();
  });
});
