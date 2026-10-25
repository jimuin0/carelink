'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConfirmedReceipt from './ConfirmedReceipt';
import Button from '@/components/ui/Button';
import { z } from 'zod';
import { readSalonBrowserContext, saveSalonBrowserContext,
  salonHandoffAuthPath } from '@/lib/salon-browser-context';

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
      <Link href="/register/recover" className="block mt-4 underline underline-offset-4">掲載申込の続きへ進む</Link>
    </div>
  </div>;
  if (!receipt) return <div className={SHELL}><p className="section-container py-12" role="status">受付状況を確認しています。</p></div>;
  return <div className={SHELL}>
    <ConfirmedReceipt id={receipt.receiptId} name={receipt.name} type={receipt.type} area={receipt.area}
      signupHref={salonHandoffAuthPath('signup')} loginHref={salonHandoffAuthPath('login')} />
  </div>;
}
