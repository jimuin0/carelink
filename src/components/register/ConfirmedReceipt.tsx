import Link from 'next/link';
import Button from '@/components/ui/Button';
import { businessTypeLabel } from '@/lib/business-type-label';
import { REGISTRATION_TERMS as T } from '@/lib/registration-glossary';
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
        <p className="text-base leading-relaxed">申込と同じメールアドレスでアカウントを作成するか、ログインしてください。</p>
      </section>
      <div className="flex flex-col gap-4 mt-4">
        <Button href={signupHref} prefetch="auto">店舗アカウントを作成する</Button>
        <Link href={loginHref} className="underline underline-offset-4">既存アカウントでログインして引き継ぐ</Link>
      </div>
      <p className="mt-6 text-sm leading-relaxed">引き継ぎ後、確認書類を提出し、運営の確認を受けてから公開できます。</p>
      <p className="mt-3 text-sm leading-relaxed">ネット予約を利用せず、無料掲載だけでも利用できます。</p>
      <p className="mt-3 text-sm leading-relaxed">複数店舗は、店舗ごとに申し込み、同じアカウントで引き継げます。</p>
      <Link href="/register/guide" className="mt-4 inline-block underline underline-offset-4">掲載までの詳しい流れを見る</Link>
      <a href="/register" target="_blank" rel="noopener noreferrer" className="mt-3 block underline underline-offset-4">別の店舗を申し込む（新しいタブ）</a>
    </div>
  );
}
