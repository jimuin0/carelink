import type { Metadata } from 'next';

// クライアントコンポーネントのページは metadata を書けないため、ページ固有の <title>（WCAG 2.4.2）をここで付ける。
export const metadata: Metadata = { title: '新規登録' };

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
