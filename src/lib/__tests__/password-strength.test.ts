/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { estimatePasswordStrength } from '../password-strength';

test('common and long repeated passwords remain low despite length or character variety', () => {
  expect(estimatePasswordStrength('password123')).toBe(0);
  expect(estimatePasswordStrength('a'.repeat(30))).toBe(0);
});

test('longer uncommon passphrases can be strong without required character classes', () => {
  expect(estimatePasswordStrength('maple canyon orbit violet')).toBe(4);
});

test('values outside registration length limits never appear strong', () => {
  expect(estimatePasswordStrength('aB3!x')).toBe(0);
  expect(estimatePasswordStrength('あ'.repeat(25))).toBe(0);
});
