import { bookingsHref } from '../admin-bookings-url';

describe('bookingsHref', () => {
  it('パラメータ無しは基底URL', () => {
    expect(bookingsHref({})).toBe('/admin/bookings');
  });

  it('status のみ', () => {
    expect(bookingsHref({ status: 'pending' })).toBe('/admin/bookings?status=pending');
  });

  it('date のみ', () => {
    expect(bookingsHref({ date: '2026-06-13' })).toBe('/admin/bookings?date=2026-06-13');
  });

  it('status と date を両方引き継ぐ（フィルタ切替で date を落とさない）', () => {
    expect(bookingsHref({ status: 'confirmed', date: '2026-06-13' })).toBe(
      '/admin/bookings?status=confirmed&date=2026-06-13'
    );
  });

  it('page は 2 以上で付与', () => {
    expect(bookingsHref({ page: 3 })).toBe('/admin/bookings?page=3');
  });

  it('page=1 は付与しない（正規形）', () => {
    expect(bookingsHref({ page: 1 })).toBe('/admin/bookings');
  });

  it('page=0 は付与しない', () => {
    expect(bookingsHref({ page: 0 })).toBe('/admin/bookings');
  });

  it('status は null だと付与しない', () => {
    expect(bookingsHref({ status: null, date: '2026-06-13' })).toBe('/admin/bookings?date=2026-06-13');
  });

  it('date は null だと付与しない', () => {
    expect(bookingsHref({ status: 'pending', date: null })).toBe('/admin/bookings?status=pending');
  });

  it('全パラメータ（status・date・page）を結合', () => {
    expect(bookingsHref({ status: 'pending', date: '2026-06-13', page: 2 })).toBe(
      '/admin/bookings?status=pending&date=2026-06-13&page=2'
    );
  });
});
