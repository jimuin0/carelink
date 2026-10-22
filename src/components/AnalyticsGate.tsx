'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Script from 'next/script';
import { GoogleAnalytics } from '@next/third-parties/google';
import {
  applyAnalyticsConsent,
  clarityTagUrl,
  hasAnalyticsConsent,
  subscribeToCookieConsent,
} from '@/lib/cookie-consent';

/**
 * GA4 と Microsoft Clarity を、Cookie バナーで分析 Cookie に同意した来訪者にだけ読み込む。
 *
 * 🔴 以前は root layout が同意と無関係に両方を全ページへ出力しており、「必須のみ」を選んでも
 * 計測が続いていた（2026年10月22日）。判定は src/lib/cookie-consent.ts が単一ソース。
 *
 * - サーバー描画と初回ハイドレーションでは「未同意」として何も出さない（同意は端末の
 *   localStorage にしか無いため。サーバーが返す HTML には計測タグが一切入らない）。
 * - バナーで保存した直後に切り替わる（再読み込み不要）。他タブでの変更にも追従する。
 * - CSP は nonce＋'strict-dynamic'。GA の初期化（gtag('config')）はインラインスクリプトなので、
 *   Next.js の CSP ガイドどおり nonce を渡す（後から挿入するインラインの扱いがブラウザごとに
 *   違っても、nonce が一致していれば必ず実行される）。
 */
function getServerConsentSnapshot(): boolean {
  return false;
}

export default function AnalyticsGate({
  gaId,
  clarityId,
  nonce,
}: {
  gaId?: string;
  clarityId?: string;
  nonce?: string;
}) {
  const consented = useSyncExternalStore(
    subscribeToCookieConsent,
    hasAnalyticsConsent,
    getServerConsentSnapshot,
  );

  // 子の <Script strategy="lazyOnload"> はページの load 後のアイドル時に挿入されるので、
  // ここで定義する Clarity のスタブは必ずタグ本体より先に存在する。
  useEffect(() => {
    applyAnalyticsConsent(consented, { gaId, clarityId });
  }, [consented, gaId, clarityId]);

  if (!consented) return null;

  return (
    <>
      {gaId && <GoogleAnalytics gaId={gaId} nonce={nonce} />}
      {clarityId && (
        <Script id="ms-clarity-tag" src={clarityTagUrl(clarityId)} strategy="lazyOnload" nonce={nonce} />
      )}
    </>
  );
}
