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

beforeEach(() => {
  localStorage.clear();
  document.cookie = '_ga=; Max-Age=0; path=/';
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
  fireEvent.click(screen.getByRole('button', { name: 'マーケティングCookieを切り替え' }));
  fireEvent.click(screen.getByRole('button', { name: '選択を保存' }));
  expect(loaded()).toEqual({ ga: 0, clarity: 0 });
  unmount();
  localStorage.clear();

  render(<><CookieConsent /><AnalyticsGate {...IDS} /></>);
  fireEvent.click(screen.getByRole('button', { name: '設定を変更' }));
  fireEvent.click(screen.getByRole('button', { name: '分析Cookieを切り替え' }));
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

// 配線の検査: root layout が計測タグを直接出していないこと（同意を迂回する経路を作らない）。
// 修正前の layout.tsx（<GoogleAnalytics> と clarity.ms/tag の <Script> を直書き）ではここが落ちる。
test('root layout は GA・Clarity を直接出さず、AnalyticsGate だけを通す', () => {
  const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
  expect(layout).not.toMatch(/@next\/third-parties\/google/);
  expect(layout).not.toMatch(/<GoogleAnalytics\b/);
  expect(layout).not.toMatch(/clarity\.ms\/tag/);
  expect(layout).toMatch(/<AnalyticsGate gaId=\{gaId\} clarityId=\{clarityId\} nonce=\{nonce\} \/>/);
});
