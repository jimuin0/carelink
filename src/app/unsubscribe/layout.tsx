import type { Metadata } from 'next';

// unsubscribe/page.tsx は 'use client' のため自身で metadata を export できず、layout.tsx が無いと
// ルート layout の default タイトル（トップページと同一の汎用文言）がそのまま使われていた。
// 専用 layout で固有タイトルを与える。ルート layout の title.template '%s | CareLink' が
// 「| CareLink」を自動付与するため、ここでは接尾辞を付けない（二重化防止）。
export const metadata: Metadata = {
  title: 'メール配信の停止',
  description: 'CareLink からのメール配信（ニュースレター等）の停止手続きを行います。',
  robots: { index: false, follow: false },
};

export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
