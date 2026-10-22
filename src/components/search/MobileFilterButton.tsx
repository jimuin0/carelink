'use client';

import dynamic from 'next/dynamic';

const MobileFilterDrawer = dynamic(() => import('./MobileFilterDrawer'), { ssr: false });

export default function MobileFilterButton({ filterCount }: { filterCount: number }) {
  return (
    <>
      <MobileFilterDrawer />
      {/* 下部ナビ（--mobile-nav-height）の上に 1.5rem 空けて置く。bottom-20 固定だと、
          画面下端に余白（safe area）がある端末ではナビに重なっていた。
          このボタンを描くページは、フッターの逃げをボタンの上端まで伸ばす
          （lib/mobile-bottom-bar.ts の FILTER_BUTTON_PATHS）。位置や大きさを変えたらそちらも合わせる。 */}
      <div className="lg:hidden fixed bottom-[calc(var(--mobile-nav-height)+1.5rem)] right-4 z-30">
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-3 bg-sky-700 text-white rounded-full shadow-lg hover:bg-sky-800 transition-colors"
          onClick={() => {
            const dialog = document.getElementById('mobile-filter-dialog');
            if (dialog) (dialog as HTMLDialogElement).showModal();
          }}
          aria-label="絞り込みフィルターを開く"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="text-sm font-bold">絞り込み</span>
          {filterCount > 0 && (
            <span className="bg-white text-sky-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{filterCount}</span>
          )}
        </button>
      </div>
    </>
  );
}
