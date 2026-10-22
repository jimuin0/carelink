'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { readSalonBrowserContext, saveSalonBrowserContext,
  salonHandoffAuthPath } from '@/lib/salon-browser-context';
import { businessTypeLabel } from '@/lib/business-type-label';

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
      <p>申込に使用したブラウザーの同じタブでご確認ください。登録済みの可能性があるため、新しい申込を送信しないでください。</p>
      <button className="btn-primary mt-4" onClick={() => { setFailed(false); setReceipt(null); setAttempt(value => value + 1); }}>同じ申込の受付状況を確認</button>
      <Link href="/contact" className="block mt-4 underline underline-offset-4">受付状況を問い合わせる</Link>
      <Link href="/register/recover" className="block mt-4 underline underline-offset-4">申込時のメールアドレスで送信済みの掲載申込を復旧</Link>
    </div>
  </div>;
  if (!receipt) return <div className={SHELL}><p className="section-container py-12" role="status">受付状況を確認しています。</p></div>;
  return <div className={SHELL}>
    <div className="section-container max-w-lg py-12">
      <h1 className="mb-4 font-(family-name:--font-serif-jp) text-2xl">掲載申込を受け付けました</h1>
      <p className="text-sm">受付番号：<span className="break-all">{receipt.receiptId}</span></p>
      <dl className="my-6 divide-y divide-(--ecru-line) border-y border-(--ecru-line) bg-(--ecru-surface) px-4 text-sm">
        <div className="flex gap-4 py-3"><dt className="w-20 shrink-0 text-(--ecru-muted)">施設名</dt><dd className="font-medium">{receipt.name}</dd></div>
        <div className="flex gap-4 py-3"><dt className="w-20 shrink-0 text-(--ecru-muted)">業種</dt><dd>{businessTypeLabel(receipt.type)}</dd></div>
        <div className="flex gap-4 py-3"><dt className="w-20 shrink-0 text-(--ecru-muted)">所在地</dt><dd>{receipt.area || '未入力（公開前に設定してください）'}</dd></div>
      </dl>
      <p className="text-sm leading-relaxed">この時点では一般公開は完了していません。店舗アカウントを作成し、管理画面で店舗名・所在地などを確認して無料掲載を公開してください。ネット予約はメニュー・スタッフ・写真・曜日別営業時間の設定完了まで利用できません。</p>
      <p className="mt-3 text-sm leading-relaxed">掲載料・予約手数料は無料です。申込や店舗アカウント作成で有料プランの契約は行いません。</p>
      <div className="flex flex-col gap-4 mt-6">
        <Link href={salonHandoffAuthPath('signup')} className="btn-primary">店舗アカウントを作成する</Link>
        <Link href={salonHandoffAuthPath('login')} className="underline underline-offset-4">既存アカウントでログインする</Link>
        <Link href="/register" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">別の店舗を新しいタブで申し込む</Link>
      </div>
      <p className="text-sm mt-4 text-(--ecru-muted)">店舗ごとに申込を分けてください。複数店舗を同じアカウントで管理したい場合は、お問い合わせください。</p>
    </div>
  </div>;
}
