'use client';

import { useState } from 'react';

/**
 * 予約時間調整のお願い 送信ボタン（SB 予約詳細用）
 * - メール送信: 無料
 * - LINE 送信: 有料オプション time_adjust_line（未購入時はサーバが 403 を返し、その文言を表示）
 */
export default function AdjustRequestButtons({ bookingId, status }: { bookingId: string; status: string }) {
  const [sending, setSending] = useState<'email' | 'line' | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 送信できるのは進行中の予約のみ（サーバ側でも同条件を強制）
  if (status !== 'pending' && status !== 'confirmed') return null;

  const send = async (channel: 'email' | 'line') => {
    setSending(channel);
    setResult(null);
    try {
      const res = await fetch('/api/admin/booking-adjust-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, channel }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult({ type: 'success', message: channel === 'email' ? '時間調整のお願いをメールで送信しました' : '時間調整のお願いをLINEで送信しました' });
      } else {
        setResult({ type: 'error', message: json.error || '送信に失敗しました' });
      }
    } catch {
      setResult({ type: 'error', message: '通信に失敗しました。時間をおいて再度お試しください。' });
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
      <h2 className="text-sm font-bold text-gray-800 mb-1">時間調整のお願い</h2>
      <p className="text-xs text-gray-500 mb-4">
        ご予約時間の調整をお客様に依頼します。メール送信は無料、LINE送信は有料オプションです。
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => send('email')}
          disabled={sending !== null}
          className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {sending === 'email' ? '送信中...' : 'メールで送る（無料）'}
        </button>
        <button
          type="button"
          onClick={() => send('line')}
          disabled={sending !== null}
          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {sending === 'line' ? '送信中...' : 'LINEで送る（有料）'}
        </button>
      </div>
      {result && (
        <p role="alert" className={`text-xs mt-3 ${result.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
