import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getCatalogsByFacility } from '@/lib/catalogs';

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  return {
    title: `ヘアカタログ | ${facility.name} | CareLink`,
    description: `${facility.name}のヘアカタログ・スタイル一覧`,
  };
}

export default async function CatalogPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const catalogs = await getCatalogsByFacility(facility.id);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            <li><Link href="/search" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium">ヘアカタログ</li>
          </ol>
        </nav>

        <div className="px-4 sm:px-6 py-6">
          <h1 className="text-xl font-bold mb-6">ヘアカタログ</h1>

          {catalogs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 text-sm">カタログがまだ登録されていません</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {catalogs.map((catalog) => (
                <div key={catalog.id} className="rounded-xl overflow-hidden border border-gray-100">
                  {catalog.after_photo_url ? (
                    <div className="relative aspect-square bg-gray-100">
                      <Image src={catalog.after_photo_url} alt={catalog.title} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="aspect-square bg-gray-100 flex items-center justify-center">
                      <span className="text-gray-400 text-sm">No Photo</span>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="font-bold text-sm line-clamp-1">{catalog.title}</p>
                    {catalog.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {catalog.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-micro bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
