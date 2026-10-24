'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { z } from 'zod';
import { readSalonBrowserContext, saveSalonBrowserContext,
  salonHandoffAuthPath } from '@/lib/salon-browser-context';
import { businessTypeLabel } from '@/lib/business-type-label';
import ReceiptNumber from '@/components/register/ReceiptNumber';
import { REGISTRATION_TERMS as T } from '@/lib/registration-glossary';
import { LISTING_PUBLISH_REQUIREMENT } from '@/lib/register-photo-policy';

const receiptSchema = z.object({ state: z.literal('confirmed'), receiptId: z.uuid(),
  name: z.string().min(1).max(200), type: z.string().min(1).max(100), area: z.string().max(500) });

/** /register と同じくすみ配色。色の値は globals.css の .theme-ecru だけが持つ。 */
const SHELL = 'theme-ecru min-h-[60vh] bg-(--ecru-bg) text-(--ecru-text)';

export default function RegistrationReceipt() {
  const [receipt, setReceipt] = useState<(z.infer<typeof receiptSchema> & { intentId: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const load = async () => {
      const selected = readSalonBrowserContext(window.sessionStorage);
      if (selected.state !== 'ready') throw new Error('No selected receipt');
      const response = await fetch('/api/salons/summary', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ intentId: selected.context.intentId }) });
      const parsed = receiptSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('Receipt not confirmed');
      if (cancelled) return;
      // Do not overwrite a different selection made while this request waited.
      const latest = readSalonBrowserContext(window.sessionStorage);
      if (latest.state !== 'ready' || latest.context.intentId !== selected.context.intentId
        || !saveSalonBrowserContext(window.sessionStorage, { ...selected.context, phase: 'confirmed' })) {
        throw new Error('Receipt context unavailable');
      }
      setReceipt({ ...parsed.data, intentId: selected.context.intentId });
    };
    void load().catch(() => { if (!cancelled) setFailed(true); }).finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  // 配色は /register と同じ .theme-ecru（globals.css が単一ソース）。ヘッダーも同じテーマに揃う。
  if (failed) return <div className={SHELL}>
    <div className="section-container max-w-lg py-12 text-center" role="alert">
      <h1 className="text-2xl font-bold mb-4">受付状況を確認できませんでした</h1>
      <p>申込に使用したブラウザーの同じタブでご確認ください。受付済みの可能性があるため、新しい申込を送信しないでください。</p>
      <Button className="mt-4" onClick={() => { setFailed(false); setReceipt(null); setAttempt(value => value + 1); }}>同じ申込の受付状況を確認</Button>
      <Link href="/contact" className="block mt-4 underline underline-offset-4">受付状況を問い合わせる</Link>
      <Link href="/register/recover" className="block mt-4 underline underline-offset-4">申込時のメールアドレスで送信済みの掲載申込を復旧</Link>
    </div>
  </div>;
  if (!receipt) return <div className={SHELL}><p className="section-container py-12" role="status">受付状況を確認しています。</p></div>;
  return <div className={SHELL}>
    <div className="section-container max-w-xl py-10 sm:py-12">
      <h1 className="mb-3 font-(family-name:--font-serif-jp) text-2xl">掲載申込を受け付けました</h1>
      <p className="mb-6 text-base leading-relaxed">申込は完了しました。一般公開は完了していません。</p>
      <ReceiptNumber id={receipt.receiptId} className="border border-(--ecru-line) bg-(--ecru-surface) p-4" />
      <dl className="my-6 divide-y divide-(--ecru-line) border-y border-(--ecru-line) bg-(--ecru-surface) px-4 text-sm">
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">{T.shopName}</dt><dd className="break-words font-medium">{receipt.name}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">業種</dt><dd>{businessTypeLabel(receipt.type)}</dd></div>
        <div className="grid gap-1 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><dt className="text-(--ecru-muted)">所在地</dt><dd className="break-words">{receipt.area || '未入力（公開前に設定してください）'}</dd></div>
      </dl>
      <section aria-labelledby="receipt-next-steps" className="space-y-4">
        <h2 id="receipt-next-steps" className="text-lg font-bold">次にすること</h2>
        <ol className="list-decimal space-y-4 pl-5 text-base leading-relaxed marker:font-bold">
          <li><p className="font-bold">店舗アカウントを作成する</p><p>申込に使ったメールアドレスで作成してください。申込内容を管理画面へ引き継げます。</p></li>
          <li><p className="font-bold">管理画面で情報を確認して公開する</p><p>{LISTING_PUBLISH_REQUIREMENT}</p></li>
        </ol>
      </section>
      <div className="flex flex-col gap-4 mt-6">
        <Button href={salonHandoffAuthPath('signup')} prefetch="auto">店舗アカウントを作成する</Button>
        <Link href={salonHandoffAuthPath('login')} className="underline underline-offset-4">既存アカウントでログインする</Link>
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
  </div>;
}
