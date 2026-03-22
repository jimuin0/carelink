'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { FacilityPhoto } from '@/types';

export default function PhotoGallery({ photos, facilityName }: { photos: FacilityPhoto[]; facilityName: string }) {
  const [selected, setSelected] = useState(0);
  const [imgError, setImgError] = useState(false);

  if (photos.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gradient-to-br from-sky-100 to-sky-50 flex flex-col items-center justify-center">
        <svg className="w-16 h-16 text-sky-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sky-300 text-sm mt-2">写真準備中</p>
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[16/9] bg-gray-100">
        {imgError ? (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-100 to-sky-50">
            <p className="text-sky-300 text-sm">画像を読み込めませんでした</p>
          </div>
        ) : (
          <Image
            src={photos[selected].photo_url}
            alt={photos[selected].caption || `${facilityName} - 写真${selected + 1}`}
            fill
            sizes="(max-width: 768px) 100vw, 800px"
            className="object-cover"
            priority={selected === 0}
            onError={() => setImgError(true)}
          />
        )}
        {/* Photo counter */}
        {photos.length > 1 && (
          <span className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
            {selected + 1} / {photos.length}
          </span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto px-4 pb-2">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              onClick={() => { setSelected(i); setImgError(false); }}
              className={`relative w-20 h-14 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                i === selected ? 'border-sky-500' : 'border-transparent hover:border-gray-300'
              }`}
              aria-label={`写真${i + 1}を表示`}
            >
              <Image
                src={photo.photo_url}
                alt={photo.caption || `${facilityName} - 写真${i + 1}`}
                fill
                sizes="80px"
                className="object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
