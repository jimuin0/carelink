'use client';

import { useState, useEffect } from 'react';

type LiffProfile = {
  line_user_id: string;
  display_name: string;
  picture_url: string | null;
  linked: boolean;
  profile: { id: string; display_name: string; email: string | null; avatar_url: string | null } | null;
};

type LiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_linked' }
  | { status: 'ready'; data: LiffProfile; accessToken: string };

export function useLiff() {
  const [state, setState] = useState<LiffState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

    async function init() {
      try {
        if (!liffId) {
          setState({ status: 'error', message: 'LIFF IDが設定されていません' });
          return;
        }

        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          setState({ status: 'error', message: 'LINEトークンの取得に失敗しました' });
          return;
        }

        const res = await fetch('/api/liff/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: accessToken }),
        });

        if (!res.ok) {
          setState({ status: 'error', message: 'LINE認証に失敗しました' });
          return;
        }

        const data = await res.json() as LiffProfile;
        if (cancelled) return;

        if (!data.linked) {
          setState({ status: 'not_linked' });
          return;
        }

        setState({ status: 'ready', data, accessToken });
      } catch (e) {
        if (!cancelled) {
          setState({ status: 'error', message: e instanceof Error ? e.message : '初期化エラー' });
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return state;
}
