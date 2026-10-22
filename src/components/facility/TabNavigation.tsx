'use client';

import { useState, useRef, useEffect, useSyncExternalStore } from 'react';

interface Tab {
  key: string;
  label: string;
  content: React.ReactNode;
  /**
   * このタブの中にある要素の id。URL の #<id> がこれに一致したら、このタブを開いて
   * その要素までスクロールする（例：口コミ依頼メールの #review-form）。
   */
  anchors?: string[];
}

interface Props {
  tabs: Tab[];
}

// URL の #hash を外部ストアとして読む。サーバー描画時は hash が無いので '' を返し、
// ハイドレーション後に実際の値で描き直す（useState の初期値で window を読むと不一致になる）。
function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
const readHash = () => window.location.hash;
const readServerHash = () => '';

/** #hash に対応するタブの key（無ければ null）。タブの key そのもの、またはタブの anchors に一致するもの。 */
export function tabKeyForHash(tabs: Pick<Tab, 'key' | 'anchors'>[], hash: string): string | null {
  const id = hash.replace(/^#/, '');
  if (!id) return null;
  return tabs.find((t) => t.key === id || t.anchors?.includes(id))?.key ?? null;
}

export default function TabNavigation({ tabs }: Props) {
  const hash = useSyncExternalStore(subscribeHash, readHash, readServerHash);
  const hashTab = tabKeyForHash(tabs, hash);
  // 利用者がタブを押したときの選択。押した時点の hash も覚えておき、その後に hash が
  // 変わった（メールのリンクや #review への移動）ときだけ hash 側のタブを優先する。
  const [picked, setPicked] = useState<{ key: string; hash: string } | null>(null);
  const activeTab = picked && (picked.hash === hash || hashTab === null)
    ? picked.key
    : (hashTab ?? tabs[0].key);
  const selectTab = (key: string) => setPicked({ key, hash });

  const [isSticky, setIsSticky] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
    selectTab(tabs[nextIndex].key);
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

  // #hash でタブを開いたら、その中の要素（#review-form 等）か、タブ全体の先頭までスクロールする。
  // 開いたタブの中身は初期描画に存在しないため、ブラウザ標準のアンカー移動は働かない
  // （口コミ依頼メールの「口コミを書く」がトップタブのまま止まっていた原因・2026年10月22日）。
  useEffect(() => {
    if (!hashTab) return;
    const target = document.getElementById(hash.slice(1)) ?? rootRef.current;
    target?.scrollIntoView({ block: 'start' });
  }, [hash, hashTab]);

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
    <div ref={rootRef} className="scroll-mt-14">
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
              onClick={() => selectTab(tab.key)}
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
