/**
 * @jest-environment jsdom
 *
 * 写真の無いスタッフは、人型のアイコンではなく名前の頭文字を出す（2026年10月23日）。
 * 人型のアイコンでは写真の無いスタッフが全員同じ顔に見え、読み込みに失敗したようにも見えていた。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StaffCard from '../StaffCard';
import { staffInitial } from '../StaffMonogram';
import type { StaffProfile } from '@/types';

jest.mock('../PreferredStaffButton', () => ({ __esModule: true, default: () => null }));

const staff = { id: 's1', facility_id: 'f1', name: '山田 花子', slug: 'hanako', photo_url: null, position: 'スタイリスト', specialties: [] } as unknown as StaffProfile;

test('写真が無ければ頭文字を出し、読み上げは名前の文字だけ（頭文字は aria-hidden）', () => {
  const { container } = render(<StaffCard staff={staff} facilitySlug="salon" />);
  const monogram = screen.getByTestId('staff-monogram');
  expect(monogram).toHaveTextContent('山');
  expect(monogram).toHaveAttribute('aria-hidden', 'true');
  expect(monogram).toHaveClass('bg-gray-100', 'text-gray-600');
  expect(container.querySelector('svg')).toBeNull();
  expect(screen.getByRole('link')).toHaveAccessibleName('山田 花子 スタイリスト');
});

test('写真があれば写真を出す', () => {
  render(<StaffCard staff={{ ...staff, photo_url: 'https://example.invalid/p.webp' }} facilitySlug="salon" />);
  expect(screen.queryByTestId('staff-monogram')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: '山田 花子' })).toBeInTheDocument();
});

test.each([
  ['  sato', 'S'],
  ['𠮷田', '𠮷'],
  ['', ''],
])('頭文字は前後の空白を除いた最初の 1 文字（%s → %s）', (name, initial) => {
  expect(staffInitial(name)).toBe(initial);
});
