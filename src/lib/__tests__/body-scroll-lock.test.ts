/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 */
import { lockBodyScroll } from '../body-scroll-lock';

afterEach(() => { document.body.style.overflow = ''; });

test('止めている数を数え、全部が閉じたときだけ元の値に戻す（どの順で閉じても同じ・Codex 指摘 ML-01）', () => {
  document.body.style.overflow = 'clip';
  const a = lockBodyScroll();
  const b = lockBodyScroll();
  expect(document.body.style.overflow).toBe('hidden');
  a();
  expect(document.body.style.overflow).toBe('hidden');
  b();
  expect(document.body.style.overflow).toBe('clip');

  const c = lockBodyScroll();
  const d = lockBodyScroll();
  d();
  expect(document.body.style.overflow).toBe('hidden');
  c();
  expect(document.body.style.overflow).toBe('clip');
});

test('同じ戻す関数を 2 回呼んでも、ほかの部品の分まで戻さない', () => {
  const a = lockBodyScroll();
  const b = lockBodyScroll();
  a();
  a();
  expect(document.body.style.overflow).toBe('hidden');
  b();
  expect(document.body.style.overflow).toBe('');
});
