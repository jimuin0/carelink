import Link from 'next/link';
import Button from '@/components/ui/Button';
import { businessTypeLabel } from '@/lib/business-type-label';
import { REGISTRATION_TERMS as T } from '@/lib/registration-glossary';
import { LISTING_PUBLISH_REQUIREMENT } from '@/lib/register-photo-policy';
import ReceiptNumber from './ReceiptNumber';

type Props = {
  id: string; name: string; type: string; area: string;
  signupHref: string; loginHref: string;
};

/** Shared by both verified receipt protocols; verification stays in each caller. */
export default function ConfirmedReceipt({ id, name, type, area, signupHref, loginHref }: Props) {
  return (
    <div className="section-container max-w-xl py-10 sm:py-12">
      <h1 className="mb-3 font-(family-name:--font-serif-jp) text-2xl">掲載申込を受け付けました</h1>
      <p className="mb-6 text-base leading-relaxed">申込の送信だけでは公開されません。</p>
      <ReceiptNumber id={id} className="rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-5" />
      <dl className="my-6 divide-y divide-(--ecru-line) border-y border-(--ecru-line) bg-(--ecru-surface) px-4 text-sm">
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">{T.shopName}</dt><dd className="break-words font-medium">{name}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">業種</dt><dd>{businessTypeLabel(type)}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">所在地</dt><dd className="break-words">{area || '未入力（公開前に設定してください）'}</dd></div>
      </dl>
      <section aria-labelledby="receipt-next-steps" className="space-y-4">
        <h2 id="receipt-next-steps" className="text-lg font-bold">次にすること</h2>
        <ol className="list-decimal space-y-4 pl-5 text-base leading-relaxed marker:font-bold">
          <li><p className="font-bold">店舗アカウントを作成する</p><p>申込に使ったメールアドレスで作成してください。申込内容を管理画面へ引き継げます。</p></li>
          <li><p className="font-bold">管理画面で情報を確認して公開する</p><p>{LISTING_PUBLISH_REQUIREMENT}</p></li>
        </ol>
      </section>
      <div className="flex flex-col gap-4 mt-6">
        <Button href={signupHref} prefetch="auto">店舗アカウントを作成する</Button>
        <Link href={loginHref} className="underline underline-offset-4">既存アカウントでログインする</Link>
      </div>
      <section aria-labelledby="receipt-listing-only" className="mt-6 space-y-2 border-t border-(--ecru-line) pt-6 text-sm leading-relaxed">
        <h2 id="receipt-listing-only" className="font-bold">予約を受け付けず、無料掲載だけでも利用できます</h2>
        <p>ネット予約の設定は別に行います。メニュー・スタッフ・写真などの予約用設定を完了するまでは、ネット予約を受け付けません。</p>
        <p>掲載料・予約手数料は無料です。申込や店舗アカウント作成で有料プランの契約は行いません。</p>
      </section>
      {/* 以前は「別の店舗を新しいタブで申し込む」を出していたが、新規の店舗アカウントは1アカウント1店舗
          （facility_members の部分 UNIQUE・/api/facility/setup の ALREADY_MEMBER）で、2 店舗目の申込は
          同じアカウントでは店舗にできない。できない手順へ誘導せず、複数店舗は運営への相談へ案内する。 */}
      <p className="text-sm mt-4 text-(--ecru-muted)">新しく作成する{T.account}で掲載できるのは1店舗です。複数店舗の掲載をご希望の場合は、<Link href="/contact" className="underline underline-offset-4">運営へお問い合わせ</Link>ください。</p>
    </div>
  );
}
