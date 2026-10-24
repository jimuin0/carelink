/**
 * @jest-environment jsdom
 *
 * 店舗向けページ（/register・/register/complete）のヘッダーは、ロゴと「店舗ログイン」だけにする
 * （2026年10月23日 神原さん決定）。来院者向けの「会員登録」「ログイン」や、今いるページへ戻る
 * 「施設掲載」を出すと、掲載を検討している店舗が客向けの会員登録へ迷い込む。
 */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import Header from '../Header';

let mockPathname = '/register';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
// AuthButton（来院者のログイン／アカウントメニュー）は dynamic import。描画されたら目印を出す。
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function AuthButtonStub() {
    return <button type="button">ログイン</button>;
  },
}));

function renderAt(pathname: string) {
  mockPathname = pathname;
  render(<Header />);
  return screen.getByRole('banner');
}

describe.each(['/register', '/register/complete', '/register/recover'])('%s のヘッダー', (pathname) => {
  it('ロゴと「店舗ログイン」だけを出す', () => {
    const header = renderAt(pathname);
    const links = within(header).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['CareLink', '店舗ログイン']);
    expect(within(header).getByRole('link', { name: '店舗ログイン' })).toHaveAttribute('href', '/auth/login?redirect=/admin');
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
    expect(header.className).toContain('theme-ecru');
  });

  it('ロゴはブランド色（--logo）で描く（テーマの --primary に追従させない）', () => {
    const header = renderAt(pathname);
    const logo = within(header).getByRole('link', { name: 'CareLink' });
    expect(logo.className).toContain('text-(--logo)');
    expect(logo.className).not.toContain('text-primary');
  });
});

describe('来院者向けページのヘッダー', () => {
  it('施設掲載は /register へ、会員登録・ログインも出す', () => {
    const header = renderAt('/');
    expect(within(header).getAllByRole('link', { name: /施設掲載/ }).every((l) => l.getAttribute('href') === '/register')).toBe(true);
    expect(within(header).getAllByRole('link', { name: /会員登録/ }).length).toBeGreaterThan(0);
    expect(within(header).getAllByRole('button', { name: 'ログイン' }).length).toBeGreaterThan(0);
    expect(header.className).not.toContain('theme-ecru');
    expect(within(header).getByRole('link', { name: 'CareLink' }).className).toContain('text-(--logo)');
  });

  it('共用の認証画面も店舗文脈を受け取れる', () => {
    mockPathname = '/auth/login';
    render(<Header shopPage />);
    expect(screen.getByRole('banner').className).toContain('theme-ecru');
  });
});
