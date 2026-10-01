import { render, screen } from '@testing-library/react';
import StickyBookingBar from '../StickyBookingBar';
jest.mock('../RemainingSlots', () => ({ __esModule: true, default: () => <span>synthetic remaining slots</span> }));
jest.mock('@/lib/analytics', () => ({ analytics: { phoneClicked: jest.fn(), bookingClicked: jest.fn() } }));
const props = { phone: '000-0000-0000', facilityName: '合成店舗', facilitySlug: 'synthetic', facilityId: 'synthetic' };
test('掲載のみならネット予約・残席を隠し、電話・問い合わせを残す', () => {
  render(<StickyBookingBar {...props} bookingAvailable={false} />);
  expect(screen.getByText(/ネット予約は準備中/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '今すぐ予約する' })).toBeNull();
  expect(screen.queryByText('synthetic remaining slots')).toBeNull();
  expect(screen.getByRole('link', { name: '電話' }).getAttribute('href')).toBe('tel:000-0000-0000');
  expect(screen.getByRole('button', { name: '合成店舗にお問い合わせ' })).toBeTruthy();
});
test('準備済みならネット予約と残席を表示する', () => {
  render(<StickyBookingBar {...props} bookingAvailable />);
  expect(screen.getByRole('link', { name: '今すぐ予約する' }).getAttribute('href')).toBe('/facility/synthetic/booking');
  expect(screen.getByText('synthetic remaining slots')).toBeTruthy();
});
