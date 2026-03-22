'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  tabs: { key: string; label: string; content: React.ReactNode }[];
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
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`tab-btn whitespace-nowrap ${activeTab === tab.key ? 'tab-btn-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 sm:px-6 py-6" role="tabpanel" id={`tabpanel-${activeTab}`}>
        {tabs.find((t) => t.key === activeTab)?.content}
      </div>
    </div>
  );
}
