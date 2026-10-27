/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import FacilityCard from '../FacilityCard';
import type { FacilityCardData } from '@/types';

const hours = { sun: null, mon: { open: '09:00', close: '18:00' }, tue: { open: '09:00', close: '18:00' },
  wed: { open: '09:00', close: '18:00' }, thu: null, fri: { open: '09:00', close: '18:00' }, sat: { open: '09:00', close: '18:00' } };
const card: FacilityCardData = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'synthetic', name: '合成院', business_type: '鍼灸院・整骨院',
  catch_copy: null, prefecture: '大阪府', city: '豊中市', access_info: null, rating_avg: 0, rating_count: 0,
  google_rating: null, google_review_count: 0, main_photo_url: null, min_price: 500, max_price: 1000,
  menu_count: 2, coupon_count: 0, photo_count: 1, business_hours: hours, seat_count: null,
  booking_menu_count: 2, active_staff_count: 1, has_address: true,
};

test('shows the previous opening during the early-morning carryover', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2026-10-26T19:00:00Z'));
    render(<FacilityCard facility={{ ...card, business_hours: { ...hours, mon: { open: '18:00', close: '05:00' }, tue: null } }} />);
    expect(screen.getByText('前日から 05:00まで')).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

test('refreshes the previous opening at its closing boundary without navigation', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2026-10-26T19:59:00Z'));
    const result = render(<FacilityCard facility={{ ...card, business_hours: { ...hours, mon: { open: '18:00', close: '05:00' }, tue: null } }} />);
    expect(screen.getByText('前日から 05:00まで')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(60_000));
    expect(screen.queryByText('前日から 05:00まで')).not.toBeInTheDocument();
    result.unmount();
  } finally { jest.useRealTimers(); }
});

test('displayed hours follow the Japanese business day across UTC midnight differences', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2026-10-25T14:59:00Z'));
    const { rerender } = render(<FacilityCard facility={card} />);
    expect(screen.queryByText('09:00 〜 18:00')).not.toBeInTheDocument();
    jest.setSystemTime(new Date('2026-10-25T15:01:00Z'));
    rerender(<FacilityCard facility={card} />);
    expect(screen.getByText('09:00 〜 18:00')).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  [{ periods: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }] }, '09:00 〜 12:00 ／ 14:00 〜 18:00'],
  [{ periods: [{ open: '20:00', close: '02:00' }] }, '20:00 〜 翌02:00'],
  [{ periods: [{ open: '00:00', close: '24:00' }] }, '24時間営業'],
])('client-rendered cards retain the new business periods: %j', (day, expected) => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2026-10-26T03:00:00Z'));
    render(<FacilityCard facility={{ ...card, business_hours: { ...hours, mon: { ...day.periods[0], ...day } } }} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('a bookable facility shows 予約OK', () => {
  render(<FacilityCard facility={card} />);
  expect(screen.getByText('予約OK')).toBeInTheDocument();
});

test('a facility whose page refuses online booking does not show 予約OK', () => {
  render(<FacilityCard facility={{ ...card, photo_count: 0 }} />);
  expect(screen.queryByText('予約OK')).not.toBeInTheDocument();
});

test('a card without readiness inputs does not claim 予約OK', () => {
  const { booking_menu_count: _m, active_staff_count: _s, has_address: _a, ...legacy } = card;
  render(<FacilityCard facility={legacy} />);
  expect(screen.queryByText('予約OK')).not.toBeInTheDocument();
});

// 掲載だけでネット予約を受け付けない施設に「空きなし」と出すと、満席だと誤って伝えてしまう（レビュー指摘）。
describe('空きの表示（予約希望日で検索したとき）', () => {
  test('ネット予約を受け付ける施設は空きあり／空きなしを出す', () => {
    const { rerender } = render(<FacilityCard facility={card} isAvailable />);
    expect(screen.getByText('空きあり')).toBeInTheDocument();
    rerender(<FacilityCard facility={card} isAvailable={false} />);
    expect(screen.getByText('空きなし')).toBeInTheDocument();
  });

  test.each([true, false])('ネット予約を受け付けない施設には出さない（isAvailable=%s）', (isAvailable) => {
    render(<FacilityCard facility={{ ...card, active_staff_count: 0 }} isAvailable={isAvailable} />);
    expect(screen.queryByText('空きあり')).not.toBeInTheDocument();
    expect(screen.queryByText('空きなし')).not.toBeInTheDocument();
  });

  test('判定できなかったとき（isAvailable 未指定）は出さない', () => {
    render(<FacilityCard facility={card} />);
    expect(screen.queryByText('空きあり')).not.toBeInTheDocument();
    expect(screen.queryByText('空きなし')).not.toBeInTheDocument();
  });
});

// 価格の色と取り消し線（2026年10月23日）。施設の価格帯は割引前の価格でも割引後の価格でもないので、
// クーポンがあっても線を引かず赤にもしない（以前は最安値に線を引き「クーポン価格あり」を赤で出していた）。
describe('価格帯の表示', () => {
  test.each([0, 3])('クーポン %i 枚でも価格帯を濃い太字でそのまま出す', (coupon_count) => {
    render(<FacilityCard facility={{ ...card, coupon_count }} />);
    const price = screen.getByTestId('facility-card-price');
    expect(price).toHaveTextContent('¥500〜¥1,000');
    expect(price).toHaveClass('font-bold', 'text-gray-900');
    expect(price.innerHTML).not.toMatch(/line-through|text-red/);
    expect(screen.queryByText('クーポン価格あり')).not.toBeInTheDocument();
  });

  test('最安値と最高値が同じ・最高値が無いときは 1 つだけ出す', () => {
    const { rerender } = render(<FacilityCard facility={{ ...card, max_price: 500 }} />);
    expect(screen.getByTestId('facility-card-price')).toHaveTextContent(/^¥500$/);
    rerender(<FacilityCard facility={{ ...card, max_price: null }} />);
    expect(screen.getByTestId('facility-card-price')).toHaveTextContent(/^¥500$/);
  });
});
