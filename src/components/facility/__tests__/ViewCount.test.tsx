/**
 * @jest-environment jsdom
 *
 * 監査 A401: 再訪では閲覧数を重複加算しないが、「最近見た施設」の並び順は更新する。
 * 監査 A402: 端末に残った壊れた値・古い形の値で RecentlyViewed を落とさない。
 */
import { render } from '@testing-library/react';
import ViewCount, { getViewedFacilities } from '../ViewCount';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true })) as unknown as typeof fetch;
});

test('再訪では加算せず、最近見た施設の先頭へ移す', () => {
  const props = { facilityName: 'A店', facilitySlug: 'a' };
  render(<ViewCount facilityId="a" {...props} />);
  render(<ViewCount facilityId="b" facilityName="B店" facilitySlug="b" />);
  expect(getViewedFacilities().map((f) => f.id)).toEqual(['b', 'a']);
  render(<ViewCount facilityId="a" {...props} />);
  expect(getViewedFacilities().map((f) => f.id)).toEqual(['a', 'b']);
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/a/view'))).toHaveLength(1);
});

test('配列でない・形が違う値は捨てる', () => {
  localStorage.setItem('viewed_facilities', JSON.stringify({ length: 3 }));
  expect(getViewedFacilities()).toEqual([]);
  localStorage.setItem('viewed_facilities', JSON.stringify([null, 1, { id: 'x' }, { id: 'ok', name: 'OK', slug: 'ok' }]));
  expect(getViewedFacilities().map((f) => f.id)).toEqual(['ok']);
  localStorage.setItem('viewed_facilities', '{broken');
  expect(getViewedFacilities()).toEqual([]);
});
