'use client';

import { useConfirmedClipboard } from '@/hooks/useConfirmedClipboard';

interface Props {
  url: string;
  title: string;
}

/**
 * 共有ボタンの見た目（2026年10月23日）。以前は LINE の緑・X の黒・Facebook の青の円を並べており、
 * 施設名の横で店舗の写真や見出しより目立っていた。ブランド色は使わず、灰色のアイコンにそろえる。
 * 押せる範囲は 44px 四方のまま（指で押しやすさは変えない）。
 */
export const SHARE_ICON_CLASS =
  'min-w-[44px] min-h-[44px] rounded-full text-gray-500 flex items-center justify-center hover:bg-gray-100 hover:text-gray-700 transition-colors';

export default function ShareButtons({ url, title }: Props) {
  const clipboard=useConfirmedClipboard(url);
  const copied=clipboard.status==='copied';
  const encoded = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const handleCopy=()=>clipboard.copy(url);

  return (
    <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="このページを共有">
      {/* スマホではタイトルの下に 1 行で並ぶため、何のボタンかを文字でも示す（PC はタイトルの横なので出さない）。 */}
      <span className="text-xs text-gray-500 mr-1 sm:hidden" aria-hidden="true">共有</span>
      {/* LINE */}
      <a
        href={`https://social-plugins.line.me/lineit/share?url=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className={SHARE_ICON_CLASS}
        aria-label="LINEで共有"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386a.63.63 0 0 1-.63-.629V8.108a.63.63 0 0 1 .63-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016a.63.63 0 0 1-.63.629.626.626 0 0 1-.51-.262l-2.418-3.294v2.926a.63.63 0 0 1-.63.63.63.63 0 0 1-.631-.63V8.108a.63.63 0 0 1 .631-.63c.2 0 .385.096.504.259l2.424 3.296V8.108a.63.63 0 0 1 .63-.63.63.63 0 0 1 .63.63v4.771zm-5.741 0a.63.63 0 0 1-1.261 0V8.108a.63.63 0 0 1 1.261 0v4.771zm-2.451.629H4.934a.63.63 0 0 1-.63-.629V8.108a.63.63 0 0 1 1.261 0v4.141h1.754c.348 0 .63.285.63.63a.63.63 0 0 1-.63.629zM24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.121.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
        </svg>
      </a>
      {/* X (Twitter) */}
      <a
        href={`https://twitter.com/intent/tweet?url=${encoded}&text=${encodedTitle}`}
        target="_blank"
        rel="noopener noreferrer"
        className={SHARE_ICON_CLASS}
        aria-label="Xで共有"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      {/* Facebook */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className={SHARE_ICON_CLASS}
        aria-label="Facebookで共有"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>
      {/* コピー */}
      <button
        type="button"
        onClick={handleCopy} disabled={clipboard.copying}
        className={SHARE_ICON_CLASS}
        aria-label="URLをコピー"
      >
        {copied ? (
          <svg className="w-4 h-4 text-green-600" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
      {clipboard.status==='failed'&&<span role="alert" className="w-full text-xs text-red-600">URLをコピーできませんでした。ブラウザの権限をご確認ください。</span>}
      {copied&&<span role="status" className="sr-only">URLをコピーしました</span>}
    </div>
  );
}
