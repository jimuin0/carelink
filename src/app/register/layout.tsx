import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '無料掲載登録 | CareLink',
  description: '医療・福祉・美容施設の掲載を無料で登録できます。最短3分で入力完了、3営業日以内に審査結果をご連絡いたします。',
  alternates: { canonical: '/register' },
  openGraph: {
    title: '無料掲載登録 | CareLink',
    description: '医療・福祉・美容施設の掲載を無料で登録。最短3分で入力完了。',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
