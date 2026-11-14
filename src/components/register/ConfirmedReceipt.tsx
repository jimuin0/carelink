import Link from 'next/link';
import Button from '@/components/ui/Button';
import { businessTypeLabel } from '@/lib/business-type-label';
import { REGISTRATION_TERMS as T } from '@/lib/registration-glossary';
import ReceiptNumber from './ReceiptNumber';
import RegistrationFlow from './RegistrationFlow';

type Props = {
  id: string; name: string; type: string; area: string;
  signupHref: string; loginHref: string;
};

/** Shared by both verified receipt protocols; verification stays in each caller. */
export default function ConfirmedReceipt({ id, name, type, area, signupHref, loginHref }: Props) {
  return (
    <div className="section-container max-w-xl py-10 sm:py-12">
      <h1 className="mb-3 font-(family-name:--font-serif-jp) text-2xl">掲載申込を受け付けました</h1>
      {/* 「まだ公開されない」は文章で繰り返さず、図で STEP 2 が「いまここ」であることで伝える。 */}
      <RegistrationFlow current="account" className="mb-8 mt-6" />
      <ReceiptNumber id={id} className="rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-5" />
      <dl className="my-6 divide-y divide-(--ecru-line) border-y border-(--ecru-line) bg-(--ecru-surface) px-4 text-sm">
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">{T.shopName}</dt><dd className="break-words font-medium">{name}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">業種</dt><dd>{businessTypeLabel(type)}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">所在地</dt><dd className="break-words">{area || '未入力（公開前に設定してください）'}</dd></div>
      </dl>
      <section aria-labelledby="receipt-next-steps" className="space-y-4">
        <h2 id="receipt-next-steps" className="text-lg font-bold">次は、アカウントの作成です</h2>
        <p className="text-base leading-relaxed">申込と同じメールアドレスで作ってください。</p>
      </section>
      <div className="flex flex-col gap-4 mt-4">
        <Button href={signupHref} prefetch="auto">店舗アカウントを作成する</Button>
        <Link href={loginHref} className="underline underline-offset-4">アカウントがある方はログイン</Link>
      </div>
      <p className="mt-6 text-sm leading-relaxed text-(--ecru-muted)">無料掲載だけの利用も、複数店舗の申込もできます。</p>
      <Link href="/register/guide" className="mt-3 inline-block underline underline-offset-4">掲載までの流れ（図）</Link>
      <a href="/register" target="_blank" rel="noopener noreferrer" className="mt-3 block underline underline-offset-4">別の店舗を申し込む（新しいタブ）</a>
    </div>
  );
}
