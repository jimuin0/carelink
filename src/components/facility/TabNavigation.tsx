'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  // lazy=true のタブはアクティブ時のみ描画（クライアント取得で副作用があるもの＝QA/口コミ）。
  // 省略時(=false)は常に DOM に描画し CSS で表示切替する（サーバ描画タブの本文を配信HTMLに載せSEO化・scale監査）。
  tabs: { key: string; label: string; content: React.ReactNode; lazy?: boolean }[];
}

export default function TabNavigation({ tabs }: Props) {
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const [isSticky, setIsSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      {/* Sentinel for sticky detection */}
      <div ref={sentinelRef} className="h-0" />
      <div className={`sticky top-0 z-30 bg-white transition-shadow ${isSticky ? 'shadow-md' : ''}`}>
        <div className="flex border-b border-gray-200 px-4 sm:px-6 overflow-x-auto scrollbar-hide" role="tablist">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              id={`tab-${tab.key}`}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              className={`tab-btn whitespace-nowrap ${activeTab === tab.key ? 'tab-btn-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        // lazy タブは非アクティブ時は未描画（クライアント取得の副作用を抑止）。
        // 非 lazy タブは常に描画し hidden で表示切替（本文を配信HTMLに載せ SEO 取りこぼしを防ぐ）。
        if (tab.lazy && !isActive) return null;
        return (
          <div
            key={tab.key}
            className="px-4 sm:px-6 py-6"
            role="tabpanel"
            id={`tabpanel-${tab.key}`}
            aria-labelledby={`tab-${tab.key}`}
            hidden={!isActive}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
