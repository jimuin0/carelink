import { bookingsHref } from '../admin-bookings-url';

describe('bookingsHref（検索フォーム型）', () => {
  it('パラメータ無しは基底URL', () => {
    expect(bookingsHref({})).toBe('/admin/bookings');
  });

  it('from のみ', () => {
    expect(bookingsHref({ from: '2026-06-01' })).toBe('/admin/bookings?from=2026-06-01');
  });

  it('to のみ', () => {
    expect(bookingsHref({ to: '2026-06-30' })).toBe('/admin/bookings?to=2026-06-30');
  });

  it('statuses（複数）は status=a,b で付与', () => {
    expect(bookingsHref({ statuses: ['pending', 'confirmed'] })).toBe('/admin/bookings?status=pending%2Cconfirmed');
  });

  it('statuses 空配列は付与しない', () => {
    expect(bookingsHref({ statuses: [] })).toBe('/admin/bookings');
  });

  it('q（お客様名）のみ', () => {
    expect(bookingsHref({ q: '山田' })).toBe('/admin/bookings?q=' + encodeURIComponent('山田'));
  });

  it('staff のみ', () => {
    expect(bookingsHref({ staff: 'abc-123' })).toBe('/admin/bookings?staff=abc-123');
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

  it('null/未指定は付与しない', () => {
    expect(bookingsHref({ from: null, to: null, q: null, staff: null, statuses: null, page: null })).toBe('/admin/bookings');
  });

  it('全パラメータを順序通り結合（ページネーションが全条件を引き継ぐ）', () => {
    expect(
      bookingsHref({ from: '2026-06-01', to: '2026-06-30', statuses: ['pending'], q: '佐藤', staff: 's1', page: 2 })
    ).toBe(
      '/admin/bookings?from=2026-06-01&to=2026-06-30&status=pending&q=' + encodeURIComponent('佐藤') + '&staff=s1&page=2'
    );
  });
});
