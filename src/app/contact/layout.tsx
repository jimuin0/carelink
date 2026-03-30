import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'お問い合わせ',
  description: 'CareLinkへのお問い合わせはこちらから。施設の掲載、検索に関するご質問、サービスに関するご相談など、お気軽にお問い合わせください。2営業日以内にご返信いたします。',
  alternates: {
    canonical: '/contact',
  },
  openGraph: {
    title: 'お問い合わせ | CareLink',
    description: '施設の掲載、検索に関するご質問など、お気軽にお問い合わせください。',
    type: 'website',
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
