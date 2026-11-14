/**
 * @jest-environment jsdom
 *
 * FacilityHeader の Google 評価表示 回帰テスト。
 * google_rating(number|null) と google_review_count(number) は sync 時に独立代入されるため
 * 「review_count>0 かつ rating=null」が発生し得る。その際 Number(null).toFixed(1)='0.0' という
 * 誤った評価を表示しないことを保証する（回帰防止）。
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import FacilityHeader, { VIEW_COUNT_DISPLAY_MIN } from '@/components/facility/FacilityHeader';
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

test('登録された複数の診療科を施設ページに表示する', () => {
  render(<FacilityHeader facility={{ ...baseFacility, medical_specialties:['内科','耳鼻咽喉科'] }} />);
  expect(screen.getByText('診療科：内科・耳鼻咽喉科')).toBeInTheDocument();
});

test('google_review_count>0 かつ google_rating=null → 「0.0」を表示せず Google バッジを出さない（回帰防止）', () => {
  render(
    <FacilityHeader facility={{ ...baseFacility, google_review_count: 5, google_rating: null }} />,
  );
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  // 件数バッジ自体も出さない（評価不在のため）
  expect(screen.queryByText('(5件)')).not.toBeInTheDocument();
});

// 2026年10月22日（神原さん判断で表示を外す）: 「N人が閲覧中」は viewCount/100 に乱数 1〜3 を
// 足した値で、閲覧が 0 でも 1〜3 人と出ていた。累計の「閲覧 N回」だけを残す。
// 修正前（ViewingNow を描画）ではハイドレーション後に「人が閲覧中」が出るのでここが落ちる。
describe('閲覧数の表示', () => {
  test('累計の「閲覧 N回」は出し、「N人が閲覧中」は出さない', async () => {
    render(<FacilityHeader facility={{ ...baseFacility, view_count: 1234 }} />);
    expect(screen.getByText(`閲覧 ${(1234).toLocaleString()}回`)).toBeInTheDocument();
    // マウント後に出る形だったので、描画の確定を待ってから確かめる。
    await act(async () => {});
    expect(screen.queryByText(/閲覧中/)).not.toBeInTheDocument();
  });

  test('閲覧 0 回の施設は閲覧に関する表示を何も出さない', async () => {
    const { container } = render(<FacilityHeader facility={{ ...baseFacility, view_count: 0 }} />);
    await act(async () => {});
    expect(container.textContent).not.toMatch(/閲覧/);
  });

  // 2026年10月23日（神原さん判断）: 100 回に届くまでは小さな閲覧数を出さない。
  test('しきい値は 100 回', () => {
    expect(VIEW_COUNT_DISPLAY_MIN).toBe(100);
  });

  test('閲覧 99 回では出さない', () => {
    const { container } = render(<FacilityHeader facility={{ ...baseFacility, view_count: 99 }} />);
    expect(container.textContent).not.toMatch(/閲覧/);
  });

  test('閲覧 100 回からは従来どおり出す', () => {
    render(<FacilityHeader facility={{ ...baseFacility, view_count: 100 }} />);
    expect(screen.getByText('閲覧 100回')).toBeInTheDocument();
  });
});

test('google_rating があるとき → 評価と件数を正しく表示する（正常系の不変確認）', () => {
  render(
    <FacilityHeader facility={{ ...baseFacility, google_review_count: 5, google_rating: 4.2 }} />,
  );
  expect(screen.getByText('4.2')).toBeInTheDocument();
  expect(screen.getByText('(5件)')).toBeInTheDocument();
});
