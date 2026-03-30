import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getPublishedFeatures } from '@/lib/features';
import Breadcrumb from '@/components/Breadcrumb';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '特集一覧',
  description: 'CareLink の特集・おすすめ企画。季節やテーマに合わせたサロン・クリニック情報をお届けします。',
  alternates: { canonical: '/feature' },
};

export default async function FeatureListPage() {
  const features = await getPublishedFeatures();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb items={[{ label: 'トップ', href: '/' }, { label: '特集一覧' }]} />

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-8">特集・おすすめ企画</h1>

        {features.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <Link
                key={f.id}
                href={`/feature/${f.slug}`}
                className="bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-shadow"
              >
                <div className="relative aspect-[16/9] bg-gradient-to-br from-sky-100 to-sky-50">
                  {f.banner_image_url ? (
                    <Image
                      src={f.banner_image_url}
                      alt={f.title}
                      fill
                      sizes="(max-width: 640px) 100vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <svg className="w-12 h-12 text-sky-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h2 className="font-bold text-lg text-gray-900 mb-2 line-clamp-2">{f.title}</h2>
                  {f.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">{f.description}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <p className="text-gray-500 text-sm font-medium">特集記事を準備中です</p>
            <p className="text-gray-400 text-xs mt-1">季節やテーマに合わせた特集をお届けします</p>
            <Link href="/" className="text-sky-600 text-sm mt-4 inline-block hover:underline">
              トップページに戻る
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
