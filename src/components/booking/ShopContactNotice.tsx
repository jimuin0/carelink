import Link from 'next/link';
import { isDialablePhone } from '@/lib/facility-contact';

/**
 * 「店舗へ直接ご連絡ください」と案内するときに、連絡の手段も一緒に出す（マイページの予約詳細・LIFF のキャンセル画面）。
 * 以前は案内の文言だけで、電話番号も店舗ページへのリンクも無く、お客様は店名で検索し直すしかなかった。
 * 電話番号は店舗ページと同じ判定（isDialablePhone）を通ったときだけ tel: リンクにする。
 * slug は公開中の店舗のときだけ渡す（非公開の店舗ページは 404 になる）。
 */
export default function ShopContactNotice({ message, phone, slug }: {
  message: string;
  phone?: string | null;
  slug?: string | null;
}) {
  const dialable = isDialablePhone(phone);
  return (
    <div className="rounded-xl bg-gray-100 p-4 text-sm text-gray-700 space-y-3">
      <p>{message}</p>
      {(dialable || slug) && (
        <div className="flex flex-col gap-2">
          {dialable && (
            <a
              href={`tel:${phone}`}
              className="block rounded-lg border border-sky-300 bg-white py-2.5 text-center font-bold text-sky-700 hover:bg-sky-50"
            >
              店舗に電話する（{phone}）
            </a>
          )}
          {slug && (
            <Link href={`/facility/${slug}`} className="block py-1 text-center text-sky-700 underline hover:no-underline">
              店舗ページを見る
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
