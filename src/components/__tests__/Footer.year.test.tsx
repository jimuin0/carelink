/** @jest-environment jsdom */
// B6-17: 著作権表記の年を JST で出す（UTC で動くサーバーと日本の端末で元日 0〜9 時に食い違わない）。
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import Footer from '../Footer';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/' }));

test('UTC 12/31 16:00（JST 元日 1:00）は翌年を表示する', () => {
  jest.useFakeTimers({ now: new Date('2026-12-31T16:00:00Z') });
  try {
    render(<Footer />);
    expect(screen.getByText(/© 2027 CareLink/)).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
