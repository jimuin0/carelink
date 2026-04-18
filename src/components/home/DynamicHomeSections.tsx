'use client';
import dynamic from 'next/dynamic';

export const HomeBelowFold = dynamic(() => import('./HomeBelowFold'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-50" />,
});

export const StickySignupCta = dynamic(() => import('./StickySignupCta'), {
  ssr: false,
});
