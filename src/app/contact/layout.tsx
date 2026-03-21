import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'お問い合わせ',
  description: 'CareLinkへのお問い合わせはこちらから。掲載・求職・その他ご質問をお気軽にどうぞ。',
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
