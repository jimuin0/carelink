'use client';

import Image from 'next/image';
import { useState, useCallback, useEffect } from 'react';
import type { FacilityPhoto } from '@/types';
import { SHIMMER_BLUR } from '@/lib/image-utils';

export default function PhotoGallery({ photos, facilityName }: { photos: FacilityPhoto[]; facilityName: string }) {
  const [selected, setSelected] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const goPrev = useCallback(() => {
    setSelected((prev) => (prev - 1 + photos.length) % photos.length);
    setImgError(false);
  }, [photos.length]);

  const goNext = useCallback(() => {
    setSelected((prev) => (prev + 1) % photos.length);
    setImgError(false);
  }, [photos.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
  }, [goNext, goPrev]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen, goNext, goPrev]);

  if (photos.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gradient-to-br from-sky-50 via-sky-100 to-indigo-50 flex flex-col items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-sky-200/50 flex items-center justify-center mb-3">
          <span className="text-3xl font-bold text-sky-400">{facilityName.charAt(0)}</span>
        </div>
        <p className="text-sky-500 text-sm font-medium">{facilityName}</p>
        <p className="text-sky-300 text-xs mt-1">写真は近日公開予定です</p>
      </div>
    );
  }

  return (
    <div role="region" aria-label="写真ギャラリー" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="relative aspect-[16/9] bg-gray-100 cursor-pointer" onClick={() => setLightboxOpen(true)}>
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
            placeholder="blur"
            blurDataURL={SHIMMER_BLUR}
            onError={() => setImgError(true)}
          />
        )}
        {photos.length > 1 && (
          <span className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
            {selected + 1} / {photos.length}
          </span>
        )}
        {/* Expand icon */}
        <span className="absolute top-3 right-3 bg-black/40 text-white p-1.5 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
        </span>
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

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="写真拡大表示"
        >
          <button onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }} className="absolute top-4 right-4 text-white/70 hover:text-white p-2" aria-label="閉じる">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {photos.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2" aria-label="前の写真">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}
          <div className="relative w-[90vw] h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <Image
              src={photos[selected].photo_url}
              alt={photos[selected].caption || `${facilityName} - 写真${selected + 1}`}
              fill
              className="object-contain"
              sizes="90vw"
            />
          </div>
          {photos.length > 1 && (
            <button onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2" aria-label="次の写真">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
          <span className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm">
            {selected + 1} / {photos.length}
          </span>
        </div>
      )}
    </div>
  );
}
