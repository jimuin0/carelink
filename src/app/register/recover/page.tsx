'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { businessTypes } from '@/lib/constants';
import { SALON_RECOVERY_ONBOARDING_PATH, saveSalonRecoveryContext, salonRecoveryAuthPath } from '@/lib/salon-browser-context';
import { businessTypeLabel } from '@/lib/business-type-label';
import ReceiptNumber from '@/components/register/ReceiptNumber';

const resultSchema = z.object({ state: z.literal('ready'), receipts: z.array(z.object({
  receipt_id: z.uuid(), facility_name: z.string().min(1).max(200),
  business_type: z.string().refine(value => businessTypes.includes(value)),
  created_at: z.string().datetime({ offset: true }).nullable(),
}).strict()).max(50), next: z.uuid().nullable() }).strict();
const preparedSchema = z.object({ state: z.literal('prepared'), recoveryId: z.uuid(),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
type Receipt = z.infer<typeof resultSchema>['receipts'][number];

/** 利用者に見せてよい案内文だけを運ぶ例外。fetch の TypeError（"Failed to fetch"）等の生の英語を画面に出さない。 */
class RecoveryNotice extends Error {}
const NETWORK_NOTICE = '通信できませんでした。電波の良い場所で、少し時間をおいてから「先頭から再確認」を押してください。再申込は不要です。';
function noticeOf(failure: unknown, fallback: string): string {
  return failure instanceof RecoveryNotice ? failure.message : fallback;
}
async function post(body: object, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch('/api/salons/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal });
  } catch {
    throw new RecoveryNotice(NETWORK_NOTICE);
  }
}

async function requestReceipts(signal: AbortSignal, after?: string) {
  const response = await post({ action: 'list', ...(after ? { after } : {}) }, signal);
  if (response.status === 401) return null;
  if (response.status === 403) throw new RecoveryNotice('申込時のメールアドレスでログインし、メール確認を完了してください。');
  const result = resultSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !result.success) throw new RecoveryNotice('受付状況を確認できません。再申込せず、時間をおいて確認してください。');
  return result.data;
}

// Network response validation happens at completion time, not render time.
async function requestPreparation(receiptId: string, signal: AbortSignal) {
  const response = await post({ action: 'prepare', receiptId }, signal);
  const result = preparedSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !result.success || Date.parse(result.data.expiresAt) <= Date.now()) {
    throw new RecoveryNotice('この申込を引き継げません。再申込せず、お問い合わせください。');
  }
  return result.data;
}

export default function RecoverRegistrationPage() {
  return <Suspense fallback={<div className="section-container max-w-xl mx-auto py-16">
    <h1 className="text-2xl font-bold mb-4">送信済みの掲載申込を復旧</h1><p role="status">受付情報を確認しています…</p></div>}>
    <RecoverRegistrationContent />
  </Suspense>;
}

function RecoverRegistrationContent() {
  const router = useRouter();
  // 引き継ぎ画面（/admin/onboarding）から、申込したタブの受付情報が無いため自動で送られてきた。
  const fromHandoff = useSearchParams().get('from') === 'handoff';
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const live = useRef(false);

  const load = async (after?: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await requestReceipts(AbortSignal.timeout(20000), after);
      if (!live.current) return;
      if (result === null) {
        router.replace(salonRecoveryAuthPath('login')); return;
      }
      setReceipts(result.receipts); setNext(result.next); setLoaded(true);
    } catch (failure) {
      if (live.current) setError(noticeOf(failure, '受付状況を確認できません。再申込せず、時間をおいて確認してください。'));
    } finally { inFlight.current = false; if (live.current) setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    live.current = true; inFlight.current = true;
    // Initial state already represents loading. Only the asynchronous response
    // changes state; StrictMode/unmount cancels this particular request.
    void (async () => {
      try {
        const result = await requestReceipts(controller.signal);
        if (cancelled) return;
        if (result === null) { router.replace(salonRecoveryAuthPath('login')); return; }
        setReceipts(result.receipts); setNext(result.next); setLoaded(true);
      } catch (failure) {
        if (!cancelled) setError(noticeOf(failure, '受付状況を確認できません。再申込せず、時間をおいて確認してください。'));
      } finally {
        clearTimeout(timer);
        if (!cancelled) { inFlight.current = false; setBusy(false); }
      }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); live.current = false; inFlight.current = false; };
  }, [router]);

  const handleSelect = async (receiptId: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await requestPreparation(receiptId, AbortSignal.timeout(20000));
      if (!live.current) return;
      if (!saveSalonRecoveryContext(window.sessionStorage, result.recoveryId)) {
        throw new RecoveryNotice('ブラウザーで引き継ぎ情報を保存できません。施設は作成していません。保存を許可して選び直してください。');
      }
      router.push(SALON_RECOVERY_ONBOARDING_PATH);
    } catch (failure) {
      if (live.current) setError(noticeOf(failure, '引き継ぎ情報を確認できません。時間をおいて選び直してください。'));
    } finally { inFlight.current = false; if (live.current) setBusy(false); }
  };

  return <div className="section-container max-w-xl mx-auto py-16">
    <h1 className="text-2xl font-bold mb-4">送信済みの掲載申込を復旧</h1>
    {fromHandoff && <div className="mb-4 rounded-lg bg-sky-50 p-4 text-sm text-sky-900" data-testid="handoff-recovery-guide">
      <p className="font-bold">申込を選んでください</p>
      <p className="mt-1">確認メールのリンクを別のタブやブラウザで開いたため、申込したときの画面の情報を引き継げませんでした。ログイン中のメールアドレスで確認できた申込を下に表示しています。続ける申込の「この申込の店舗情報を確認」を押してください。再申込は不要です。</p>
    </div>}
    <p className="mb-4 text-sm">申込に使用した確認済みメールアドレスに一致する受付を表示します。タブを閉じた場合や受付確認の期限が切れた場合も、再申込は不要です。選択だけでは施設を作成・公開しません。</p>
    {busy && <p role="status">受付情報を確認しています…</p>}
    {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
    {loaded && !error && receipts.length === 0 && <p className="mb-4">一致する受付を確認できませんでした。別の申込メールや取り込み状況は自動判定できません。再送する前にお問い合わせください。</p>}
    <ul className="space-y-4 mb-4">{receipts.map(receipt => <li key={receipt.receipt_id} className="rounded-sm border p-4">
      <p className="font-bold">{receipt.facility_name}</p><p>{businessTypeLabel(receipt.business_type)}</p>
      <ReceiptNumber id={receipt.receipt_id} />
      <Button disabled={busy} onClick={() => void handleSelect(receipt.receipt_id)} className="mt-3">この申込の店舗情報を確認</Button>
    </li>)}</ul>
    {next && <Button variant="secondary" disabled={busy} onClick={() => void load(next)} className="mb-4">次の受付を表示</Button>}
    <Button variant="secondary" disabled={busy} onClick={() => void load()} className="mb-4 ml-2">先頭から再確認</Button>
    <p className="text-sm">異なるメールアドレス、他の管理者に取り込み済みの申込、重複店舗の統合、複数店舗の管理は自動処理しません。<Link href="/contact" className="underline">お問い合わせ</Link>で受付番号をお知らせください。</p>
  </div>;
}
