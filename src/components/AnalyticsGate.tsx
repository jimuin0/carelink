'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { GoogleAnalytics } from '@next/third-parties/google';
import {
  applyAnalyticsConsent,
  applySessionRecordingScope,
  clarityTagUrl,
  hasAnalyticsConsent,
  subscribeToCookieConsent,
} from '@/lib/cookie-consent';
import { isSessionRecordingAllowedPath } from '@/lib/session-recording-scope';

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
 * - 🔴 Clarity（セッション録画）は公開の閲覧ページだけで動かす（判定は
 *   src/lib/session-recording-scope.ts）。管理画面・マイページ・予約・問診などを直接開いたときは
 *   タグを出さず、公開ページから遷移してきたときは録画を止める。表示されている文字は
 *   Clarity の既定のマスクでは隠れず、お客様の氏名・連絡先が録画されていた（2026年10月22日）。
 *   GA4 は画面の内容を送らないので全ページで読み込む。
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

  const recordingAllowed = isSessionRecordingAllowedPath(usePathname());

  // 反映した最後の状態。同じ状態を二度反映しない（Clarity のキューに同意を重ねて積まない）。
  const applied = useRef<string | null>(null);
  // Clarity のタグを一度でも出したか／録画を止めているか。タグを出す前は止める対象が無い。
  const clarityInserted = useRef(false);
  const recordingStopped = useRef(false);

  // 子の <Script strategy="lazyOnload"> はページの load 後のアイドル時に挿入されるので、
  // ここで定義する Clarity のスタブは必ずタグ本体より先に存在する。
  //
  // 🔴 反映には描画値の consented ではなく、保存値を読み直した結果を使う。
  // ハイドレーションのコミットでは consented がサーバー側の値（false）のままで、実値（true）への
  // 再描画はこの effect の後に来る。描画値で判定すると、同意済みの来訪者でもページを読み込むたびに
  // 撤回側（GA の送信停止・_ga/_ga_<ID>/_clck/_clsk の削除）が走り、GA では毎回新しいユーザー、
  // Clarity では録画が細切れになっていた（2026年10月22日 レビューで判明）。
  // consented は「保存値が変わったので読み直す」きっかけとして依存配列に残す。
  useEffect(() => {
    const live = hasAnalyticsConsent();
    const key = `${live}|${gaId ?? ''}|${clarityId ?? ''}`;
    if (applied.current === key) return;
    applied.current = key;
    applyAnalyticsConsent(live, { gaId, clarityId });
  }, [consented, gaId, clarityId]);

  // 録画してはいけない画面へのクライアント遷移で止め、公開ページへ戻ったら再開する。
  useEffect(() => {
    if (consented && recordingAllowed && clarityId) clarityInserted.current = true;
    if (!clarityInserted.current) return;
    recordingStopped.current = applySessionRecordingScope(recordingAllowed, recordingStopped.current);
  }, [consented, recordingAllowed, clarityId]);

  if (!consented) return null;

  return (
    <>
      {gaId && <GoogleAnalytics gaId={gaId} nonce={nonce} />}
      {clarityId && recordingAllowed && (
        <Script id="ms-clarity-tag" src={clarityTagUrl(clarityId)} strategy="lazyOnload" nonce={nonce} />
      )}
    </>
  );
}
