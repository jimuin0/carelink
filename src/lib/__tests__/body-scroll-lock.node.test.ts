/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { lockBodyScroll } from '../body-scroll-lock';

test('document が無い環境（サーバー）では何もしない', () => {
  const release = lockBodyScroll();
  expect(() => release()).not.toThrow();
});
