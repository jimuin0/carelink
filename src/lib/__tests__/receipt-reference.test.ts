/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { receiptShortReference } from '../receipt-reference';

test('a UUID becomes its first 8 hex digits, uppercased, grouped 4-4', () => {
  expect(receiptShortReference('3f2a9c1e-0000-4000-8000-000000000001')).toBe('3F2A-9C1E');
  expect(receiptShortReference('B1000000-0000-4000-8000-000000000001')).toBe('B100-0000');
});

test('the reference is deterministic for the same receipt', () => {
  const id = 'abcdef12-3456-4789-8abc-def012345678';
  expect(receiptShortReference(id)).toBe(receiptShortReference(id));
  expect(receiptShortReference(id)).toHaveLength(9);
});

test.each(['', 'not-a-uuid', '3f2a9c1e'])('a non-UUID value is returned unchanged, never guessed: %j', value => {
  expect(receiptShortReference(value)).toBe(value);
});
