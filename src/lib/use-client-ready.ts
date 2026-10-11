'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Native form controls stay disabled in SSR/the first hydration render. Once
// their React handlers are installed, unlock without waiting for Auth/network
// state or resetting values that the user subsequently enters.
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
