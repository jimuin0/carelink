/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MyPageNav from '../MyPageNav';

jest.mock('next/navigation', () => ({ usePathname: () => '/mypage' }));

// 回数券・月額プランは「今はなし」（2026年10月23日 神原さん判断）。何も持っていない人の
// ナビからは外す（どれを外すかは layout が src/lib/feature-toggles.ts の hiddenMypageHrefs で決める）。
test('hiddenHrefs に挙げた導線は出さず、他の導線は残す', () => {
  render(<MyPageNav hiddenHrefs={['/mypage/packages', '/mypage/subscriptions']} />);
  expect(screen.queryByRole('link', { name: '回数券' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '月額プラン' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'クーポン' })).toHaveAttribute('href', '/mypage/coupons');
});

test('既定（何も外さない）では全ての導線を出す', () => {
  render(<MyPageNav />);
  expect(screen.getByRole('link', { name: '回数券' })).toHaveAttribute('href', '/mypage/packages');
  expect(screen.getByRole('link', { name: '月額プラン' })).toHaveAttribute('href', '/mypage/subscriptions');
});
