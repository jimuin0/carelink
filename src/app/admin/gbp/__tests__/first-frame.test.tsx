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
              in: () => ({
                limit: () => ({
                  single: () => Promise.resolve({ data: { facility_id: 'facility-1' }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () =>
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

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/gbp/place');

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

    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/admin/gbp/place')).toHaveLength(1);

    handle.unmount();
  });
});
