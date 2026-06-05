'use client';

/**
 * 同意ゲート付きアナリティクス（スケール監査 #4・法令対応）
 *
 * 事実: これまで GA4 / Microsoft Clarity は Cookie 同意状態と無関係に常時ロードされ、
 *   CookieConsent が保存する同意値(getCookiePreferences)を読む消費者が一つも存在しなかった
 *   （＝同意バナーが実際にはタグ発火を一切ブロックしない consent-washing 状態）。
 *
 * 対策: 同意値を読み、analytics 同意で GA4、marketing 同意で Clarity（セッション録画/ヒートマップ）
 *   を初めてロードする。同意前は何も発火しない。CookieConsent 保存時に dispatch される
 *   'cookie-consent-changed' を購読し、同意直後にリロードなしで反映する。
 *
 * Clarity は医療PII画面を録画し得るため marketing 同意を必須とする（個人情報保護法・
 * 電気通信事業法 外部送信規律の趣旨に沿わせる）。
 */
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { GoogleAnalytics } from '@next/third-parties/google';
import { getCookiePreferences } from './CookieConsent';

export default function ConsentedAnalytics({ gaId, clarityId }: { gaId?: string; clarityId?: string }) {
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const read = () => {
      const p = getCookiePreferences();
      setAnalytics(!!p?.analytics);
      setMarketing(!!p?.marketing);
    };
    read();
    window.addEventListener('cookie-consent-changed', read);
    return () => window.removeEventListener('cookie-consent-changed', read);
  }, []);

  return (
    <>
      {gaId && analytics && <GoogleAnalytics gaId={gaId} />}
      {clarityId && marketing && (
        <Script src={`https://www.clarity.ms/tag/${clarityId}`} strategy="lazyOnload" />
      )}
    </>
  );
}
