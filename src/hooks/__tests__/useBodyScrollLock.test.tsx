/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from '../useBodyScrollLock';

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

test('先に別の部品が止めていた値は、閉じたときにそのまま戻す', () => {
  document.body.style.overflow = 'clip';
  const { rerender } = renderHook(({ active }) => useBodyScrollLock(active), { initialProps: { active: true } });
  expect(document.body.style.overflow).toBe('hidden');
  rerender({ active: false });
  expect(document.body.style.overflow).toBe('clip');
});
