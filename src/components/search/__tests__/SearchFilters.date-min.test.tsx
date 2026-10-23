/**
 * 予約希望日の下限（min）は JST の今日（2026年10月23日）。
 *
 * 旧実装は new Date().toISOString()（UTC）で下限を作っていたため、JST 0:00〜8:59 は
 * 前日が選べ、当日（JST）が選べなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SearchFilters from '../SearchFilters';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { jest.useRealTimers(); });

test.each([
  ['2027-06-09T16:30:00Z', '2027-06-10'], // JST 01:30（UTC ではまだ前日）
  ['2027-06-10T14:59:00Z', '2027-06-10'], // JST 23:59
  ['2027-06-10T15:00:00Z', '2027-06-11'], // JST 翌日 00:00
])('%s の下限は JST の %s', (now, expected) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  render(<SearchFilters />);
  expect(screen.getByLabelText('予約希望日')).toHaveAttribute('min', expected);
});
