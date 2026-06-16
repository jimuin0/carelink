/**
 * @jest-environment jsdom
 *
 * FacilityHeader の Google 評価表示 回帰テスト。
 * google_rating(number|null) と google_review_count(number) は sync 時に独立代入されるため
 * 「review_count>0 かつ rating=null」が発生し得る。その際 Number(null).toFixed(1)='0.0' という
 * 誤った評価を表示しないことを保証する（回帰防止）。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import FacilityHeader from '@/components/facility/FacilityHeader';
import type { Facility } from '@/types';

const baseFacility = {
  business_type: '美容室',
  is_verified: false,
  verified_type: null,
  rating_count: 0,
  rating_avg: 0,
  google_review_count: 0,
  google_rating: null,
  view_count: 0,
} as unknown as Facility;

test('google_review_count>0 かつ google_rating=null → 「0.0」を表示せず Google バッジを出さない（回帰防止）', () => {
  render(
    <FacilityHeader facility={{ ...baseFacility, google_review_count: 5, google_rating: null }} />,
  );
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  // 件数バッジ自体も出さない（評価不在のため）
  expect(screen.queryByText('(5件)')).not.toBeInTheDocument();
});

test('google_rating があるとき → 評価と件数を正しく表示する（正常系の不変確認）', () => {
  render(
    <FacilityHeader facility={{ ...baseFacility, google_review_count: 5, google_rating: 4.2 }} />,
  );
  expect(screen.getByText('4.2')).toBeInTheDocument();
  expect(screen.getByText('(5件)')).toBeInTheDocument();
});
