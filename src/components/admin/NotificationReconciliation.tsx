'use client';

import { useRef, useState } from 'react';
import { UUID_REGEX } from '@/lib/constants';

/** No message content, credentials, customer address, resend or fence reset. */
export default function NotificationReconciliation() {
  const [operationId, setOperationId] = useState('');
  const [providerMessageId, setProviderMessageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  async function reconcile() {
    if (inFlight.current) return;
    const operation = operationId.trim();
    const message = providerMessageId.trim();
    setResult(null);
    if (!UUID_REGEX.test(operation) || !UUID_REGEX.test(message)) {
      setResult({ success: false, text: '操作IDとメールサービスのメッセージIDをUUID形式で入力してください。' });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/notification-reconciliation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operation, providerMessageId: message }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.accepted !== true) {
        setResult({ success: false, text: '受理記録を確定できませんでした。権限、元の操作IDとメールサービスの受理記録を確認してください。再送は行っていません。' });
        return;
      }
      setResult({ success: true, text: '保存内容と一致するメールサービスの受理記録を照合しました。受信箱への配達完了を意味しません。再送は行っていません。' });
    } catch {
      setResult({ success: false, text: '照合結果が不明です。同じ操作IDとメッセージIDで再照合してください。再送は行っていません。' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <details className="rounded-lg border border-gray-200 bg-white p-4">
    <summary className="cursor-pointer font-medium">予約通知などの受理記録を照合（運営専用）</summary>
    <p className="my-3 text-sm text-gray-600">結果不明で保留された予約通知などについて、監視記録の操作IDとメールサービスで確認したメッセージIDを照合します。問い合わせ返信は各問い合わせ内の照合機能を使ってください。メールは送信しません。</p>
    <div className="space-y-3">
      <label className="block text-sm" htmlFor="notification-operation">操作ID
        <input id="notification-operation" value={operationId} onChange={e => { setOperationId(e.target.value); setResult(null); }} disabled={busy} maxLength={36} autoComplete="off" className="mt-1 block w-full rounded-sm border p-2" />
      </label>
      <label className="block text-sm" htmlFor="notification-provider">メールサービスのメッセージID
        <input id="notification-provider" value={providerMessageId} onChange={e => { setProviderMessageId(e.target.value); setResult(null); }} disabled={busy} maxLength={36} autoComplete="off" className="mt-1 block w-full rounded-sm border p-2" />
      </label>
      <button type="button" disabled={busy} onClick={reconcile} className="rounded-sm bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? '照合中…' : '受理記録を照合（送信しない）'}</button>
      {result && <p role={result.success ? 'status' : 'alert'} className="text-sm">{result.text}</p>}
    </div>
  </details>;
}
