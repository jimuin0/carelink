import type { Metadata } from 'next';

// クライアントコンポーネントのページは metadata を書けないため、ページ固有の <title>（WCAG 2.4.2）をここで付ける。
export const metadata: Metadata = { title: '新しいパスワードを設定' };

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
