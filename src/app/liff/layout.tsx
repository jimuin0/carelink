import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CareLink',
  robots: { index: false },
};

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  );
}
