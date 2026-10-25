'use client';

import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

/** One delegated router handler replaces thousands of per-link hook instances. */
export function useFooterNavigation() {
  const router = useRouter();
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a');
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || anchor.hasAttribute('download') ||
        (anchor.target && anchor.target.toLowerCase() !== '_self') ||
        anchor.origin !== window.location.origin) return;
    event.preventDefault();
    router.push(`${anchor.pathname}${anchor.search}${anchor.hash}`);
  };
}
