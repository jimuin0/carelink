/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { closeOnLinkClick, useBodyScrollLock, useMobileMenuAutoClose } from '../useBodyScrollLock';

afterEach(() => { document.body.style.overflow = ''; });

test('開いている間だけ body のスクロールを止め、閉じたら元に戻す', () => {
  const { rerender, unmount } = renderHook(({ active }) => useBodyScrollLock(active), { initialProps: { active: false } });
  expect(document.body.style.overflow).toBe('');
  rerender({ active: true });
  expect(document.body.style.overflow).toBe('hidden');
  rerender({ active: false });
  expect(document.body.style.overflow).toBe('');
  rerender({ active: true });
  unmount();
  expect(document.body.style.overflow).toBe('');
});

describe('useMobileMenuAutoClose', () => {
  const listeners = new Set<() => void>();
  let matches = false;
  beforeEach(() => {
    listeners.clear();
    matches = false;
    window.matchMedia = jest.fn(() => ({
      get matches() { return matches; },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })) as unknown as typeof window.matchMedia;
  });

  test('ページが変わったら閉じる', () => {
    const close = jest.fn();
    const { rerender } = renderHook(({ path }) => useMobileMenuAutoClose(true, close, '48rem', path), { initialProps: { path: '/search' } });
    close.mockClear();
    rerender({ path: '/search' });
    expect(close).not.toHaveBeenCalled();
    rerender({ path: '/' });
    expect(close).toHaveBeenCalled();
  });

  test('画面幅が広がってメニューが隠れたら閉じ、閉じている間は見張らない', () => {
    const close = jest.fn();
    const { rerender, unmount } = renderHook(({ open }) => useMobileMenuAutoClose(open, close, '48rem', '/'), { initialProps: { open: false } });
    expect(listeners.size).toBe(0);
    close.mockClear();
    rerender({ open: true });
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
    expect(close).not.toHaveBeenCalled();
    matches = true;
    listeners.forEach((fn) => fn());
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  test('開いた時点ですでに広い画面なら、すぐ閉じる', () => {
    matches = true;
    const close = jest.fn();
    renderHook(() => useMobileMenuAutoClose(true, close, '40rem', '/'));
    expect(close).toHaveBeenCalledTimes(2); // ページの確認で 1 回・幅の確認で 1 回
  });

  test('matchMedia が無い環境では幅を見張らない', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    const close = jest.fn();
    renderHook(() => useMobileMenuAutoClose(true, close, '40rem', '/'));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

test('closeOnLinkClick：リンクの中を押したときだけ閉じる', () => {
  const close = jest.fn();
  const handler = closeOnLinkClick(close);
  const a = document.createElement('a');
  const span = document.createElement('span');
  a.appendChild(span);
  handler({ target: span });
  expect(close).toHaveBeenCalledTimes(1);
  handler({ target: document.createElement('button') });
  handler({ target: null });
  expect(close).toHaveBeenCalledTimes(1);
});
