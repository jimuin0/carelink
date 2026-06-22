'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  tabs: { key: string; label: string; content: React.ReactNode }[];
}

export default function TabNavigation({ tabs }: Props) {
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const [isSticky, setIsSticky] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  // WAI-ARIA tab pattern: roving tabindex を矢印/Home/End キーで移動できるようにする。
  // これが無いと非アクティブタブ(tabIndex=-1)へキーボードで到達できず操作不能になる。
  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = tabs.findIndex((t) => t.key === activeTab);
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    setActiveTab(tabs[nextIndex].key);
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

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
      <div className={`sticky top-14 z-30 bg-white transition-shadow ${isSticky ? 'shadow-md' : ''}`}>
        <div ref={tablistRef} onKeyDown={handleTabKeyDown} className="flex border-b border-gray-200 px-4 sm:px-6 overflow-x-auto scrollbar-hide" role="tablist">
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
      <div className="px-4 sm:px-6 py-6" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {tabs.find((t) => t.key === activeTab)?.content}
      </div>
    </div>
  );
}
