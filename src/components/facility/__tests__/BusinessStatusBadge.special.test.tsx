/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import BusinessStatusBadge from '../BusinessStatusBadge';

const mockCalendar = jest.fn();
jest.mock('@/components/facility/usePublicHolidayCalendar', () => ({ usePublicHolidayCalendar: () => mockCalendar() }));
const hours = { sun: null, mon: { open:'09:00', close:'18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null };
const special = { closed_dates: [] as string[], close_on_public_holidays: false, reception_cutoff_minutes: 15 };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2030-01-07T08:50:00Z')); mockCalendar.mockReturnValue(null); });
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });
test('受付終了時刻を過ぎると受付終了を表示する', () => {
  render(<BusinessStatusBadge businessHours={hours} specialHours={special} />);
  expect(screen.getByRole('status')).toHaveTextContent('受付終了');
});
test('臨時休業の日には営業中を表示しない', () => {
  render(<BusinessStatusBadge businessHours={hours} specialHours={{ ...special, closed_dates: ['2030-01-07'] }} />);
  expect(screen.getByRole('status')).toHaveTextContent('営業時間外');
});
test('祝日の情報が不明な場合は営業中を断定しない', () => {
  render(<BusinessStatusBadge businessHours={hours} specialHours={{ ...special, close_on_public_holidays:true }} />);
  expect(screen.queryByRole('status')).toBeNull();
});
test('確認済み祝日は営業時間外として表示する', () => {
  mockCalendar.mockReturnValue({from:'2030-01-01',through:'2030-12-31',dates:new Set(['2030-01-07'])});
  render(<BusinessStatusBadge businessHours={hours} specialHours={{ ...special, close_on_public_holidays:true }} />);
  expect(screen.getByRole('status')).toHaveTextContent('営業時間外');
});
