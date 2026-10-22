/**
 * @jest-environment jsdom
 *
 * GA4・Microsoft Clarity を Cookie バナーの同意に従属させたことの回帰テスト（2026年10月22日 新設）。
 *
 * 【不具合】root layout が GA4 と Clarity を同意と無関係に全ページへ出しており、バナーで
 * 「必須のみ」を選んでも計測が続いていた。ここでは「どの状態で何を描画するか」を、
 * 実際のバナー（CookieConsent）を押す操作まで含めて固定する。
 *
 * 計測タグそのもの（next/script・@next/third-parties）は記録用の部品に差し替える。
 * 本物は一度読み込むとモジュール内のキャッシュで二度目を出さないため、
 * 「出ていない」ことの検査が前のテストの影響で緑になり得るから。
 * 本物を使った配線（nonce・スタブの順序）は AnalyticsGate.real-scripts.test.tsx が見る。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: { id?: string; src?: string; strategy?: string; nonce?: string }) => (
    <span data-testid="next-script" data-id={props.id} data-src={props.src} data-strategy={props.strategy} data-nonce={props.nonce} />
  ),
}));
// 録画してよい画面の判定（src/lib/session-recording-scope.ts）はパスで決まる。既定は公開のトップ。
let mockPathname: string | null = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: (props: { gaId: string; nonce?: string }) => (
    <span data-testid="google-analytics" data-ga-id={props.gaId} data-nonce={props.nonce} />
  ),
}));

import AnalyticsGate from '@/components/AnalyticsGate';
import CookieConsent from '@/components/CookieConsent';
import { COOKIE_CONSENT_STORAGE_KEY, LEGACY_COOKIE_CONSENT_STORAGE_KEY } from '@/lib/cookie-consent';

type W = Window & Record<string, unknown>;
const w = window as unknown as W;
const IDS = { gaId: 'G-TEST1', clarityId: 'abc123', nonce: 'n0nce' };

function store(analytics: boolean) {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics, marketing: false }));
}

function loaded() {
  return {
    ga: screen.queryAllByTestId('google-analytics').length,
    clarity: screen.queryAllByTestId('next-script').filter((el) => el.dataset.src?.startsWith('https://www.clarity.ms/tag/')).length,
  };
}

function cookieNames(): string[] {
  return document.cookie.split(';').map((p) => p.split('=')[0]!.trim()).filter(Boolean).sort();
}

beforeEach(() => {
  mockPathname = '/';
  localStorage.clear();
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
  delete w.clarity;
  delete w['ga-disable-G-TEST1'];
});

test('未回答（バナー表示中）は GA も Clarity も読み込まない', () => {
  render(<AnalyticsGate {...IDS} />);
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  expect(w['ga-disable-G-TEST1']).toBe(true);
  expect(w.clarity).toBeUndefined();
});

test('「必須のみ」を保存済みなら読み込まず、以前の版が付けた _ga も消す', () => {
  store(false);
  document.cookie = '_ga=GA1.1.1.2; path=/';
  render(<AnalyticsGate {...IDS} />);
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  expect(document.cookie).not.toContain('_ga=');
});

test('旧キー（v1）の accepted だけでは読み込まない（区分の無い旧回答を分析の同意にしない）', () => {
  localStorage.setItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY, 'accepted');
  render(<AnalyticsGate {...IDS} />);
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
});

test('分析に同意済みなら GA と Clarity を nonce 付きで読み込み、Clarity は公式スタブに同意を積む', () => {
  store(true);
  render(<AnalyticsGate {...IDS} />);
  expect(loaded()).toEqual({ ga: 1, clarity: 1 });
  expect(screen.getByTestId('google-analytics')).toHaveAttribute('data-ga-id', 'G-TEST1');
  expect(screen.getByTestId('google-analytics')).toHaveAttribute('data-nonce', 'n0nce');
  const tag = screen.getByTestId('next-script');
  expect(tag).toHaveAttribute('data-src', 'https://www.clarity.ms/tag/abc123');
  expect(tag).toHaveAttribute('data-strategy', 'lazyOnload');
  expect(tag).toHaveAttribute('data-nonce', 'n0nce');
  expect(w['ga-disable-G-TEST1']).toBe(false);
  const queue = (w.clarity as unknown as { q: ArrayLike<unknown>[] }).q;
  expect(queue.map((a) => Array.from(a))).toEqual([['consent']]);
});

test('ID が片方だけなら、その片方だけを読み込む', () => {
  store(true);
  const { unmount } = render(<AnalyticsGate gaId="G-TEST1" />);
  expect(loaded()).toEqual({ ga: 1, clarity: 0 });
  unmount();
  render(<AnalyticsGate clarityId="abc123" />);
  expect(loaded()).toEqual({ ga: 0, clarity: 1 });
});

test('サーバー描画は同意済みの端末でも何も出さない（HTML に計測タグを入れない）', () => {
  store(true);
  const html = renderToString(<AnalyticsGate {...IDS} />);
  expect(html).toBe('');
});

// 本番のページ読み込みは render()（クライアントだけのマウント）ではなくハイドレーションを通る。
// ハイドレーションのコミットでは useSyncExternalStore がサーバー側の値（未同意）を返し、
// 実値（同意済み）への再描画はその後になる。修正前は、この一瞬の「未同意」で撤回側の処理が走り、
// 同意済みの来訪者の _ga・_ga_<ID>・_clck・_clsk を読み込みのたびに消していた
// （GA ではページを開くたびに新しいユーザー、Clarity では録画が細切れになる）。
describe('ハイドレーション（本番のページ読み込みと同じ経路）', () => {
  function recordGaDisableWrites(): boolean[] {
    const writes: boolean[] = [];
    Object.defineProperty(window, 'ga-disable-G-TEST1', {
      configurable: true,
      get: () => writes[writes.length - 1],
      set: (value: boolean) => {
        writes.push(value);
      },
    });
    return writes;
  }

  async function hydrate() {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<AnalyticsGate {...IDS} />);
    document.body.appendChild(container);
    await act(async () => {
      render(<AnalyticsGate {...IDS} />, { container, hydrate: true });
    });
  }

  afterEach(() => {
    delete w['ga-disable-G-TEST1'];
  });

  test('同意済みなら、既存の GA・Clarity の Cookie を消さず、GA の送信停止も一度も立てない', async () => {
    store(true);
    document.cookie = '_ga=GA1.1.1.2; path=/';
    document.cookie = '_ga_TEST1=GS1.1.1; path=/';
    document.cookie = '_clck=abc; path=/';
    document.cookie = '_clsk=def; path=/';
    const writes = recordGaDisableWrites();

    await hydrate();

    expect(cookieNames()).toEqual(['_clck', '_clsk', '_ga', '_ga_TEST1']);
    expect(writes).not.toContain(true);
    expect(writes[writes.length - 1]).toBe(false);
    expect(loaded()).toEqual({ ga: 1, clarity: 1 });
    // 同意の通知は 1 回だけ（ハイドレーション後の再描画で重ねて積まない）
    const queue = (w.clarity as unknown as { q: ArrayLike<unknown>[] }).q;
    expect(queue.map((a) => Array.from(a))).toEqual([['consent']]);
  });

  test('未同意（「必須のみ」）なら、ハイドレーション経路でも Cookie を消して GA を止める', async () => {
    store(false);
    document.cookie = '_ga=GA1.1.1.2; path=/';
    document.cookie = '_clck=abc; path=/';
    const writes = recordGaDisableWrites();

    await hydrate();

    expect(cookieNames()).toEqual([]);
    expect(writes).toEqual([true]);
    expect(loaded()).toEqual({ ga: 0, clarity: 0 });
    expect(w.clarity).toBeUndefined();
  });
});

test('バナーで「すべて同意」を押すと、再読み込みなしでその場で読み込む', () => {
  render(<><CookieConsent /><AnalyticsGate {...IDS} /></>);
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'すべて同意' }));
  expect(loaded()).toEqual({ ga: 1, clarity: 1 });
  expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
});

test('バナーで「必須のみ」を押しても読み込まない', () => {
  render(<><CookieConsent /><AnalyticsGate {...IDS} /></>);
  fireEvent.click(screen.getByRole('button', { name: '必須のみ' }));
  expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!)).toEqual({ necessary: true, analytics: false, marketing: false });
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
});

test('詳細設定で分析を ON にして保存したときだけ読み込む（マーケティングだけでは読み込まない）', () => {
  const { unmount } = render(<><CookieConsent /><AnalyticsGate {...IDS} /></>);
  fireEvent.click(screen.getByRole('button', { name: '設定を変更' }));
  fireEvent.click(screen.getByRole('switch', { name: 'マーケティングCookie' }));
  fireEvent.click(screen.getByRole('button', { name: '選択を保存' }));
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  unmount();
  localStorage.clear();

  render(<><CookieConsent /><AnalyticsGate {...IDS} /></>);
  fireEvent.click(screen.getByRole('button', { name: '設定を変更' }));
  fireEvent.click(screen.getByRole('switch', { name: '分析Cookie' }));
  fireEvent.click(screen.getByRole('button', { name: '選択を保存' }));
  expect(loaded()).toEqual({ ga: 1, clarity: 1 });
});

test('他タブで同意を取り消すと、このタブでも GA を止め・Clarity に撤回を伝え・_ga を消す', () => {
  store(true);
  render(<AnalyticsGate {...IDS} />);
  expect(loaded()).toEqual({ ga: 1, clarity: 1 });
  const clarity = jest.fn();
  w.clarity = clarity; // clarity.js が読み込み済みの状態
  document.cookie = '_ga=GA1.1.1.2; path=/';

  act(() => {
    store(false);
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE_CONSENT_STORAGE_KEY }));
  });

  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  expect(w['ga-disable-G-TEST1']).toBe(true);
  expect(clarity).toHaveBeenCalledWith('consent', false);
  expect(document.cookie).not.toContain('_ga=');
});

// 🔴 Clarity は録画を送る。管理画面・マイページ・予約などで動くと、表示されている氏名・電話番号・
// メールアドレス（店舗の管理画面では同意していないお客様のもの）が録画に載る（2026年10月22日）。
// 修正前は画面を問わずタグを出しており、下の「直接開いた」テストでタグが 1 本出て落ちる。
describe('セッション録画（Clarity）は公開の閲覧ページだけ', () => {
  function queued(): unknown[][] {
    const clarity = w.clarity as unknown as { q?: ArrayLike<unknown>[] } | undefined;
    return (clarity?.q ?? []).map((a) => Array.from(a));
  }

  test.each(['/admin/customers', '/mypage/bookings', '/facility/some-salon/booking', '/intake/some-salon', '/auth/login'])(
    '同意済みでも %s を直接開いたら Clarity のタグを出さない（GA は読み込む）',
    (path) => {
      store(true);
      mockPathname = path;
      render(<AnalyticsGate {...IDS} />);
      expect(loaded()).toEqual({ ga: 1, clarity: 0 });
      // タグを出していないので止める対象も無い（同意を伝えるだけで、止める・再開するは積まない）
      expect(queued()).toEqual([['consent']]);
    },
  );

  test('パスが分からないときも Clarity は出さない（安全側）', () => {
    store(true);
    mockPathname = null;
    render(<AnalyticsGate {...IDS} />);
    expect(loaded()).toEqual({ ga: 1, clarity: 0 });
  });

  test('公開ページから管理画面へ遷移したら録画を止め、公開ページへ戻ったら再開する', () => {
    store(true);
    mockPathname = '/search';
    const { rerender } = render(<AnalyticsGate {...IDS} />);
    expect(loaded()).toEqual({ ga: 1, clarity: 1 });
    const clarity = jest.fn();
    w.clarity = clarity; // clarity.js が読み込み済みの状態

    mockPathname = '/admin/customers';
    rerender(<AnalyticsGate {...IDS} />);
    expect(clarity.mock.calls).toEqual([['stop']]);
    expect(loaded()).toEqual({ ga: 1, clarity: 0 });

    mockPathname = '/admin/bookings'; // 録画しない画面どうしの遷移では重ねて止めない
    rerender(<AnalyticsGate {...IDS} />);
    expect(clarity.mock.calls).toEqual([['stop']]);

    mockPathname = '/facility/some-salon';
    rerender(<AnalyticsGate {...IDS} />);
    expect(clarity.mock.calls).toEqual([['stop'], ['start']]);
    expect(loaded()).toEqual({ ga: 1, clarity: 1 });
  });

  test('管理画面を直接開いてから公開ページへ移ったときは、タグを出すだけで止める・再開するは積まない', () => {
    store(true);
    mockPathname = '/admin';
    const { rerender } = render(<AnalyticsGate {...IDS} />);
    expect(loaded()).toEqual({ ga: 1, clarity: 0 });
    mockPathname = '/search';
    rerender(<AnalyticsGate {...IDS} />);
    expect(loaded()).toEqual({ ga: 1, clarity: 1 });
    expect(queued()).toEqual([['consent']]);
  });
});

// 配線の検査: root layout が計測タグを直接出していないこと（同意を迂回する経路を作らない）。
// 修正前の layout.tsx（<GoogleAnalytics> と clarity.ms/tag の <Script> を直書き）ではここが落ちる。
test('root layout は GA・Clarity を直接出さず、AnalyticsGate だけを通す', () => {
  const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
  expect(layout).not.toMatch(/@next\/third-parties\/google/);
  expect(layout).not.toMatch(/<GoogleAnalytics\b/);
  expect(layout).not.toMatch(/clarity\.ms\/tag/);
  expect(layout).toMatch(/<AnalyticsGate gaId=\{gaId\} clarityId=\{clarityId\} nonce=\{nonce\} \/>/);
});
