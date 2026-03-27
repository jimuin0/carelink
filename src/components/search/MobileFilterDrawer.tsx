'use client';

import { useEffect, useRef } from 'react';
import SearchFilters from './SearchFilters';

export default function MobileFilterDrawer() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener('click', handler);
    return () => dialog.removeEventListener('click', handler);
  }, []);

  return (
    <dialog
      id="mobile-filter-dialog"
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 p-0 w-full h-full max-w-full max-h-full bg-transparent backdrop:bg-black/50"
    >
      <div className="absolute right-0 top-0 h-full w-[85vw] max-w-sm bg-white shadow-xl overflow-y-auto animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">絞り込み</h2>
          <button
            onClick={() => dialogRef.current?.close()}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="閉じる"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <SearchFilters className="p-5" />
      </div>
    </dialog>
  );
}
