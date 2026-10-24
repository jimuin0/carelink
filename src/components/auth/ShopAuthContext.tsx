'use client';

import { createContext } from 'react';

/** 配色と戻るリンクだけの文脈。認証・権限判定には使わない。 */
export const ShopAuthContext = createContext<string | null>(null);
