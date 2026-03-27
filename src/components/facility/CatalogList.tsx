import Image from 'next/image';
import type { TreatmentCatalog } from '@/types';
import { SHIMMER_BLUR } from '@/lib/image-utils';

interface Props {
  catalogs: TreatmentCatalog[];
}

export default function CatalogList({ catalogs }: Props) {
  if (catalogs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 text-sm">まだカタログが登録されていません</p>
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-6 p-4 sm:p-6">
      {catalogs.map((catalog) => (
        <div key={catalog.id} className="bg-gray-50 rounded-xl overflow-hidden">
          {/* ビフォーアフター */}
          {(catalog.before_photo_url || catalog.after_photo_url) && (
            <div className="flex">
              {catalog.before_photo_url && (
                <div className="relative flex-1 aspect-square">
                  <Image src={catalog.before_photo_url} alt="Before" fill className="object-cover" sizes="25vw" placeholder="blur" blurDataURL={SHIMMER_BLUR} />
                  <span className="absolute bottom-1 left-1 bg-black/50 text-white text-micro px-1.5 py-0.5 rounded">Before</span>
                </div>
              )}
              {catalog.after_photo_url && (
                <div className="relative flex-1 aspect-square">
                  <Image src={catalog.after_photo_url} alt="After" fill className="object-cover" sizes="25vw" placeholder="blur" blurDataURL={SHIMMER_BLUR} />
                  <span className="absolute bottom-1 left-1 bg-sky-500/80 text-white text-micro px-1.5 py-0.5 rounded">After</span>
                </div>
              )}
            </div>
          )}
          <div className="p-3">
            <h4 className="font-bold text-sm mb-1">{catalog.title}</h4>
            {catalog.description && (
              <p className="text-xs text-gray-500 line-clamp-2">{catalog.description}</p>
            )}
            {catalog.tags && catalog.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {catalog.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-micro text-gray-500">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
