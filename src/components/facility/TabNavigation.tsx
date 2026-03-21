'use client';

import { useState } from 'react';

interface Props {
  tabs: { key: string; label: string; content: React.ReactNode }[];
}

export default function TabNavigation({ tabs }: Props) {
  const [activeTab, setActiveTab] = useState(tabs[0].key);

  return (
    <div>
      <div className="flex border-b border-gray-200 px-4 sm:px-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`tab-btn whitespace-nowrap ${activeTab === tab.key ? 'tab-btn-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="px-4 sm:px-6 py-6">
        {tabs.find((t) => t.key === activeTab)?.content}
      </div>
    </div>
  );
}
