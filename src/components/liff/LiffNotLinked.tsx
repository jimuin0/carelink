import Link from 'next/link';
import { isLineLoginEnabled } from '@/lib/line-availability';

/**
 * LIFF の各画面（予約・ポイント・クーポン・キャンセル）で、LINE とアカウントがまだ連携されていないときの案内。
 *
 * 以前は「設定ページへ」とだけ出し、設定ページ側は「LINE連携はLINEアプリのリッチメニューから行えます」と
 * 案内していたため、リッチメニュー → 設定ページ → リッチメニューと行き来するだけで連携できなかった。
 * 連携の入口は設定ページの「LINEと連携する」（/api/auth/line?mode=link）なので、ボタンもその名前にする。
 * LINE ログインのチャネルが未設定（isLineLoginEnabled() が false）の間は連携できないので、ボタンを出さない。
 */
export default function LiffNotLinked() {
  const canLink = isLineLoginEnabled();
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-4">
        <p className="text-2xl">🔗</p>
        <p className="font-bold text-gray-900">LINE連携が必要です</p>
        {canLink ? (
          <>
            <p className="text-sm text-gray-500">CareLinkにログインし、「LINEと連携する」から連携してください。</p>
            <Link
              href="/mypage/settings"
              className="inline-block bg-green-700 text-white px-6 py-2.5 rounded-full text-sm font-bold"
            >
              LINEと連携する
            </Link>
          </>
        ) : (
          <p className="text-sm text-gray-500">現在、LINE連携の受付を停止しています。</p>
        )}
      </div>
    </div>
  );
}
