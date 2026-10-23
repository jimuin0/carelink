import type { Metadata } from 'next';

// クライアントコンポーネントのページは metadata を書けないため、ページ固有の <title>（WCAG 2.4.2）をここで付ける。
export const metadata: Metadata = { title: 'パスワードの再設定' };

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
