'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { FacilityPhoto } from '@/types';

export default function PhotoGallery({ photos, facilityName }: { photos: FacilityPhoto[]; facilityName: string }) {
  const [selected, setSelected] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center text-gray-300 text-6xl">
        🏢
      </div>
    );
  }

  return (
    <div>
      <div className="relative aspect-[16/9] bg-gray-100">
        <Image
          src={photos[selected].photo_url}
          alt={photos[selected].caption || facilityName}
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto px-4 pb-2">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              onClick={() => setSelected(i)}
              className={`relative w-20 h-14 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                i === selected ? 'border-sky-500' : 'border-transparent'
              }`}
            >
              <Image
                src={photo.photo_url}
                alt={photo.caption || `写真${i + 1}`}
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
