/**
 * @jest-environment jsdom
 *
 * AnalyticsGate を本物の next/script・@next/third-parties で描画し、実際に挿入される
 * <script> を検査する（2026年10月22日 新設）。
 *
 * 1. GA の初期化（インラインの gtag('config')）に CSP の nonce が付くこと。
 *    CSP は nonce＋'strict-dynamic'。後から挿入するインラインの扱いはブラウザの実装に依存するため、
 *    Next.js の CSP ガイドどおり nonce を渡して、どのブラウザでも確実に実行されるようにする。
 * 2. Clarity のタグ（www.clarity.ms/tag/<ID>）が挿入される時点で window.clarity（公式スニペットの
 *    スタブ）が既に在ること。タグ本体は先頭で window.clarity.v を読むため、スタブが無いと
 *    TypeError で止まり clarity.js を読み込まない（本番で 1 件も記録されていなかった原因）。
 *
 * 本物の next/script はモジュール内キャッシュで同じスクリプトを二度挿入しないので、
 * このファイルでは同意済みの描画を 1 回だけ行う。
 */
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import AnalyticsGate from '@/components/AnalyticsGate';
import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/cookie-consent';

type W = Window & Record<string, unknown>;
const w = window as unknown as W;

test('同意済み: GA の初期化に nonce が付き、Clarity のタグはスタブの後に挿入される', async () => {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: true, marketing: false }));
  // jsdom に無い performance.mark(name, { detail }) を @next/third-parties が呼ぶため用意する。
  if (typeof performance.mark !== 'function') {
    (performance as unknown as { mark: () => void }).mark = () => undefined;
  }

  const clarityAtInsert: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLScriptElement && node.src.startsWith('https://www.clarity.ms/tag/')) {
          clarityAtInsert.push(typeof w.clarity);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  render(<AnalyticsGate gaId="G-TEST1" clarityId="abc123" nonce="n0nce" />);

  // GA: 初期化（インライン）と gtag.js（src）の 2 本。どちらにも nonce が付く。
  await waitFor(() => expect(document.getElementById('_next-ga-init')).not.toBeNull());
  const init = document.getElementById('_next-ga-init') as HTMLScriptElement;
  expect(init.getAttribute('nonce')).toBe('n0nce');
  expect(init.textContent).toContain("gtag('config', 'G-TEST1'");
  const gtag = document.getElementById('_next-ga') as HTMLScriptElement;
  expect(gtag.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST1');

  // Clarity: lazyOnload なのでアイドル時に挿入される。挿入の瞬間にスタブが在ること。
  await waitFor(() => expect(clarityAtInsert).toHaveLength(1));
  observer.disconnect();
  expect(clarityAtInsert).toEqual(['function']);
  const tag = document.getElementById('ms-clarity-tag') as HTMLScriptElement;
  expect(tag.src).toBe('https://www.clarity.ms/tag/abc123');
  const queue = (w.clarity as unknown as { q: ArrayLike<unknown>[] }).q;
  expect(queue.map((a) => Array.from(a))).toEqual([['consent']]);
});
