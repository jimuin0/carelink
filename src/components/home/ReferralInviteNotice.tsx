'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { referralCodeFromParam, referralLoginHref, referralSignupHref } from '@/lib/referral-code';

// URL のクエリはこの画面の表示中に変わらないので購読はしない（CookieConsent と同じ形）。
const subscribe = () => () => {};
const readSearch = () => window.location.search;
// サーバー（ISR）とハイドレーション時はクエリ無しとして何も描かず、その後ブラウザの値へ切り替わる。
const serverSearch = () => '';

/**
 * 紹介リンク（トップの `?ref=コード`。/mypage/referral の X・LINE 共有が作る）で来た方に、
 * コードの受け取り方を案内する。リンクは登録・ログイン後の入力画面へコードを運び、
 * 入力欄へ事前入力される（src/lib/referral-code.ts）。
 * 以前は `?ref=` をどこも読んでおらず、リンクから来てもコードの行き先が無かった。
 *
 * トップは ISR のため、クエリはブラウザで読む（サーバーで読むと全員分が動的描画になる）。
 * `?ref=` が無い・形が合わないときは何も描かない。
 */
export default function ReferralInviteNotice() {
  const search = useSyncExternalStore(subscribe, readSearch, serverSearch);
  const code = referralCodeFromParam(new URLSearchParams(search).get('ref'));

  if (!code) return null;

  return (
    <section aria-label="紹介コードのご案内" className="bg-sky-50 border-b border-sky-100">
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="flex-1 text-sm text-gray-800">
          紹介コード「<span className="font-mono font-bold tracking-wider">{code}</span>」が届いています。{'会員登録のあと、初回のご予約の前に入力すると、初回のご予約完了で300ポイントをお受け取りいただけます。'}
        </p>
        <div className="flex items-center gap-4 shrink-0">
          <Link
            href={referralSignupHref(code)}
            prefetch={false}
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-bold hover:bg-sky-800 transition-colors"
          >
            会員登録してコードを入力
          </Link>
          <Link href={referralLoginHref(code)} prefetch={false} className="text-sm text-sky-700 underline hover:no-underline">
            ログインして入力
          </Link>
        </div>
      </div>
    </section>
  );
}
