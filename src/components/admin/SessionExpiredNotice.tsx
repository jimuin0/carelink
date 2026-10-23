import Link from 'next/link';

/**
 * ログインが切れたときの案内（管理画面の各ページ共通）。
 *
 * 以前は写真の画面がログイン切れを「管理できる店舗がありません」と表示しており、
 * 店舗が消えたのかと誤解させていた。ログインし直せば戻れることと、その導線を出す。
 * redirectTo はログイン後に戻る管理画面のパス（/admin で始まるものだけ。それ以外は /admin）。
 */
export default function SessionExpiredNotice({ redirectTo = '/admin' }: { redirectTo?: string }) {
  const back = redirectTo.startsWith('/admin') ? redirectTo : '/admin';
  return (
    <div role="alert" className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <p className="font-bold">セッションが切れました。再ログインしてください。</p>
      <p className="mt-1">ログインしてから一定の時間がたったため、ログインが切れています。ログインし直すと、この画面に戻ります。</p>
      <Link href={`/auth/login?redirect=${encodeURIComponent(back)}`} prefetch={false} className="btn-primary mt-3 px-5! py-2! text-sm">
        ログインし直す
      </Link>
    </div>
  );
}
