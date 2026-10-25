import type { Metadata } from 'next';

// クライアントコンポーネントのページは metadata を書けないため、ページ固有の <title>（WCAG 2.4.2）をここで付ける。
// ログインした申込者だけが使う復旧画面なので検索結果には出さない。
export const metadata: Metadata = {
  title: '掲載申込の続き',
  robots: { index: false, follow: false },
};

export default function RegisterRecoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
