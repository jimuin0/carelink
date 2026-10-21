/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
