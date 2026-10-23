import type { Metadata } from 'next';

// クライアントコンポーネントのページは metadata を書けないため、ページ固有の <title>（WCAG 2.4.2）をここで付ける。
// ログインした申込者だけが使う復旧画面なので検索結果には出さない。
export const metadata: Metadata = {
  title: '送信済みの掲載申込を復旧',
  robots: { index: false, follow: false },
};

export default function RegisterRecoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
