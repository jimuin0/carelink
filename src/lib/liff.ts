'use client';

import type Liff from '@line/liff';

let liffInstance: typeof Liff | null = null;
let initialized = false;

export async function initLiff(liffId: string): Promise<typeof Liff> {
  if (initialized && liffInstance) return liffInstance;

  const liff = (await import('@line/liff')).default;
  await liff.init({ liffId });
  liffInstance = liff;
  initialized = true;
  return liff;
}

export function getLiffId(): string {
  return process.env.NEXT_PUBLIC_LIFF_ID ?? '';
}
