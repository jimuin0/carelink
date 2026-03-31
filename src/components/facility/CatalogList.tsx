'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import type { TreatmentCatalog, StaffProfile, FacilityMenu } from '@/types';
import { SHIMMER_BLUR } from '@/lib/image-utils';
import dynamic from 'next/dynamic';

const BeforeAfterSlider = dynamic(() => import('@/components/catalog/BeforeAfterSlider'), { ssr: false });

interface Props {
  catalogs: TreatmentCatalog[];
  staff?: StaffProfile[];
  menus?: FacilityMenu[];
}

export default function CatalogList({ catalogs, staff, menus }: Props) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const allTags = useMemo(() => Array.from(new Set(catalogs.flatMap((c) => c.tags || []))), [catalogs]);

  if (catalogs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 text-sm">まだカタログが登録されていません</p>
      </div>
    );
  }
  const filtered = selectedTag ? catalogs.filter((c) => c.tags?.includes(selectedTag)) : catalogs;

  const getStaffName = (staffId?: string | null) => {
    if (!staffId || !staff) return null;
    return staff.find((s) => s.id === staffId)?.name ?? null;
  };
  const getMenuName = (menuId?: string | null) => {
    if (!menuId || !menus) return null;
    return menus.find((m) => m.id === menuId)?.name ?? null;
  };

  return (
    <div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 sm:px-6 pt-4 mb-2">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              !selectedTag ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
            }`}
          >
            すべて
          </button>
          {allTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                selectedTag === tag ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-6 p-4 sm:p-6">
        {filtered.map((catalog) => {
          const hasBoth = catalog.before_photo_url && catalog.after_photo_url;
          const staffName = getStaffName(catalog.staff_id);
          const menuName = getMenuName(catalog.menu_id);
          return (
            <div key={catalog.id} className="bg-gray-50 rounded-xl overflow-hidden">
              {hasBoth ? (
                <BeforeAfterSlider
                  beforeUrl={catalog.before_photo_url!}
                  afterUrl={catalog.after_photo_url!}
                  title={catalog.title}
                />
              ) : (catalog.before_photo_url || catalog.after_photo_url) ? (
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
              ) : null}
              <div className="p-3">
                <h4 className="font-bold text-sm mb-1">{catalog.title}</h4>
                {(staffName || menuName) && (
                  <p className="text-xs text-gray-400 mb-1">
                    {staffName && <>担当: {staffName}</>}
                    {staffName && menuName && ' | '}
                    {menuName && <>メニュー: {menuName}</>}
                  </p>
                )}
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
          );
        })}
      </div>
    </div>
  );
}
