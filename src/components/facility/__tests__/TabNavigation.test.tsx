/**
 * @jest-environment jsdom
 *
 * 施設ページのタブを URL の #hash で開く（2026年10月22日 新設）。
 *
 * 口コミ依頼メールの「口コミを書く」は /facility/<slug>#review を指していたが、ページに
 * その id は無く、口コミタブも開かれなかった（押してもトップタブのまま）。
 * TabNavigation が #hash に対応するタブ（key 一致、または anchors に含まれる id）を
 * マウント時と hashchange で開き、その要素までスクロールすることを固定する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TabNavigation, { tabKeyForHash } from '../TabNavigation';

const scrollIntoView = jest.fn();

beforeAll(() => {
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  scrollIntoView.mockClear();
  window.history.replaceState(null, '', '/facility/test');
});

const tabs = [
  { key: 'top', label: 'トップ', content: <p>トップの内容</p> },
  { key: 'review', label: '口コミ', anchors: ['review-form'], content: <div id="review-form">口コミを投稿する</div> },
  { key: 'access', label: 'アクセス', content: <p>アクセスの内容</p> },
];

function setHash(hash: string) {
  act(() => {
    window.history.replaceState(null, '', `/facility/test${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

test('hash が無ければ先頭タブを表示する（従来どおり）', () => {
  render(<TabNavigation tabs={tabs} />);
  expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'true');
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test('#review-form で開くと口コミタブを開き、投稿欄までスクロールする（メールのリンク先）', () => {
  window.history.replaceState(null, '', '/facility/test#review-form');
  render(<TabNavigation tabs={tabs} />);
  expect(screen.getByRole('tab', { name: '口コミ' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('口コミを投稿する')).toBeInTheDocument();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('review-form'));
});

test('#review（タブの key）でも口コミタブを開き、タブの先頭までスクロールする（既存リンクの互換）', () => {
  window.history.replaceState(null, '', '/facility/test#review');
  const { container } = render(<TabNavigation tabs={tabs} />);
  expect(screen.getByRole('tab', { name: '口コミ' })).toHaveAttribute('aria-selected', 'true');
  expect(scrollIntoView.mock.instances[0]).toBe(container.firstChild);
});

test('表示中に hash が変わったら（hashchange）そのタブへ切り替える', () => {
  render(<TabNavigation tabs={tabs} />);
  setHash('#access');
  expect(screen.getByRole('tab', { name: 'アクセス' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('アクセスの内容')).toBeInTheDocument();
});

test('hash で開いた後でもタブを押せばそちらを表示し、次に hash が変われば hash 側を開く', () => {
  window.history.replaceState(null, '', '/facility/test#review');
  render(<TabNavigation tabs={tabs} />);
  fireEvent.click(screen.getByRole('tab', { name: 'トップ' }));
  expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'true');
  setHash('#review-form');
  expect(screen.getByRole('tab', { name: '口コミ' })).toHaveAttribute('aria-selected', 'true');
});

test('タブに無関係な hash（スキップリンク等）では選択中のタブを変えずスクロールもしない', () => {
  render(<TabNavigation tabs={tabs} />);
  fireEvent.click(screen.getByRole('tab', { name: 'アクセス' }));
  setHash('#main-content');
  expect(screen.getByRole('tab', { name: 'アクセス' })).toHaveAttribute('aria-selected', 'true');
  expect(scrollIntoView).not.toHaveBeenCalled();
});

test('キーボード操作（矢印・Home・End）でタブを移動できる', () => {
  render(<TabNavigation tabs={tabs} />);
  const tablist = screen.getByRole('tablist');
  fireEvent.keyDown(tablist, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '口コミ' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tablist, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'アクセス' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tablist, { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'アクセス' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tablist, { key: 'a' });
  expect(screen.getByRole('tab', { name: 'アクセス' })).toHaveAttribute('aria-selected', 'true');
});

test('tabKeyForHash は key 一致と anchors 一致の両方を解決し、空・不明は null', () => {
  expect(tabKeyForHash(tabs, '#review')).toBe('review');
  expect(tabKeyForHash(tabs, '#review-form')).toBe('review');
  expect(tabKeyForHash(tabs, '#access')).toBe('access');
  expect(tabKeyForHash(tabs, '')).toBeNull();
  expect(tabKeyForHash(tabs, '#')).toBeNull();
  expect(tabKeyForHash(tabs, '#unknown')).toBeNull();
});
