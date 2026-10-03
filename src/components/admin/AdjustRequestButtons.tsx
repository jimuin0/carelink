'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { isLineEnabled } from '@/lib/line-availability';
import { UUID_REGEX } from '@/lib/constants';

const OPERATION_CHANGED = 'carelink-adjust-operation-changed';
function subscribeOperation(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(OPERATION_CHANGED, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(OPERATION_CHANGED, listener);
  };
}
const noServerOperation = () => false;

/**
 * 予約時間調整のお願い 送信ボタン（SB 予約詳細用）
 * - メール送信: 無料
 * - LINE 送信: 有料オプション time_adjust_line（未購入時はサーバが 403 を返し、その文言を表示）
 */
export default function AdjustRequestButtons({ bookingId, status }: { bookingId: string; status: string }) {
  const [sending, setSending] = useState<'email' | 'line' | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const flight = useRef(false);
  const pendingOperation = useSyncExternalStore(subscribeOperation, () => {
    try { return sessionStorage.getItem(`carelink-adjust-operation/${bookingId}`) !== null; }
    catch { return false; }
  }, noServerOperation);
  const active = status === 'pending' || status === 'confirmed';

  // 新規依頼は進行中のみ。終了済みでも結果不明の既存操作は照合できる。
  if (!active && !pendingOperation && !result) return null;

  const send = async (channel: 'email' | 'line') => {
    if (flight.current) return;
    flight.current = true;
    setSending(channel);
    setResult(null);
    try {
      // Save only an opaque operation ID, before I/O. A lost response/reload
      // must not create a new operation against a newer booking revision.
      const storageKey = `carelink-adjust-operation/${bookingId}`;
      let operationId: string | undefined;
      if (channel === 'email') {
        const saved = sessionStorage.getItem(storageKey);
        if (saved !== null && !UUID_REGEX.test(saved)) throw new Error('invalid saved operation');
        if (!active && saved === null) throw new Error('no previous operation');
        operationId = saved ?? crypto.randomUUID();
        sessionStorage.setItem(storageKey, operationId);
        window.dispatchEvent(new Event(OPERATION_CHANGED));
      }
      const res = await fetch('/api/admin/booking-adjust-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, channel, ...(operationId ? { operationId } : {}) }),
      });
      const json = await res.json();
      if (res.ok && json?.ok === true && (channel !== 'email' || ['queued','already_queued'].includes(json.notification))) {
        if (channel === 'email') {
          sessionStorage.removeItem(storageKey);
          window.dispatchEvent(new Event(OPERATION_CHANGED));
        }
        setResult({ type: 'success', message: channel === 'email'
          ? json.notification === 'already_queued' ? 'この予約の調整依頼は受付済みです。重複送信は行いません。'
            : '調整依頼のメール送信を受け付けました。配達完了を保証するものではありません。'
          : '時間調整のお願いをLINEで送信しました' });
      } else {
        setResult({ type: 'error', message: json?.error || '通知の受付を確認できません' });
      }
    } catch {
      setResult({ type: 'error', message: '通知の受付結果を確認できません。この画面で同じメール依頼を再確認してください。新しい依頼は作成せず、保存した操作を照合します。' });
    } finally {
      setSending(null);
      flight.current = false;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xs p-6 mt-6">
      <h2 className="text-sm font-bold text-gray-800 mb-1">時間調整のお願い</h2>
      {/* LINE 送信は、顧客側に LINE 連携の導線が無ければ有料オプションを買っても届かない。
          ローンチ段階では LINE を設定しない方針のため、LIFF 未設定の間はボタンごと出さず、
          説明文も無料のメール送信だけの内容にする（設定すれば自動で戻る。
          判定理由は lib/line-availability.ts）。サーバ側の権利チェックは変更しない。 */}
      <p className="text-xs text-gray-500 mb-4">
        {!active ? '保存された依頼の受付結果を照合します。新しい依頼や重複送信は行いません。' : isLineEnabled()
          ? 'ご予約時間の調整をお客様に依頼します。メール送信は無料、LINE送信は有料オプションです。'
          : 'ご予約時間の調整をお客様にメールで依頼します。送信は無料です。'}
      </p>
      <div className="flex gap-3">
        {(active || pendingOperation) && <button
          type="button"
          onClick={() => send('email')}
          disabled={sending !== null}
          className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {sending === 'email' ? '確認中...' : active ? 'メールで送る（無料）' : 'メールの受付結果を照合'}
        </button>}
        {active && isLineEnabled() && (
          <button
            type="button"
            onClick={() => send('line')}
            disabled={sending !== null}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            {sending === 'line' ? '送信中...' : 'LINEで送る（有料）'}
          </button>
        )}
      </div>
      {result && (
        <p role="alert" className={`text-xs mt-3 ${result.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
