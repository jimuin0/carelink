'use client';

import { useState } from 'react';
import { trackNpsSubmitted } from '@/lib/analytics-events';

interface Props {
  facilityId?: string;
  bookingId?: string;
  category?: 'facility' | 'platform' | 'overall';
  facilityName?: string;
  onDismiss?: () => void;
}

export default function NpsSurvey({ facilityId, bookingId, category = 'overall', facilityName, onDismiss }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const getLabel = (s: number) => {
    if (s >= 9) return '非常に満足';
    if (s >= 7) return '満足';
    if (s >= 5) return '普通';
    if (s >= 3) return '不満';
    return '非常に不満';
  };

  const getColor = (s: number) => {
    if (s >= 9) return 'bg-green-500 text-white';
    if (s >= 7) return 'bg-sky-500 text-white';
    if (s >= 5) return 'bg-yellow-400 text-white';
    if (s >= 3) return 'bg-orange-400 text-white';
    return 'bg-red-500 text-white';
  };

  const handleSubmit = async () => {
    if (score === null || loading) return;
    setLoading(true);
    setError(false);

    try {
      const res = await fetch('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, facility_id: facilityId, booking_id: bookingId, comment: comment || undefined, category }),
      });
      // res.ok を検証せず submitted にすると、HTTP エラー（4xx/5xx）でも送信完了と偽装される。
      if (!res.ok) { setError(true); return; }
      trackNpsSubmitted(score, bookingId);
      setSubmitted(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-medium text-gray-800 mb-1">フィードバックありがとうございます！</p>
        <p className="text-sm text-gray-500">ご意見はサービス改善に活用します</p>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="mt-3 text-xs text-gray-400 hover:underline">閉じる</button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-800 text-sm">
            {facilityName ? `「${facilityName}」をご友人に勧めますか？` : 'CareLink をご友人に勧めますか？'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">0（まったく勧めない）〜 10（ぜひ勧めたい）</p>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="閉じる" className="text-gray-400 hover:text-gray-600 shrink-0 p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* スコア選択 */}
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setScore(i)}
            className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
              score === i ? getColor(i) : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {i}
          </button>
        ))}
      </div>

      {score !== null && (
        <>
          <p className="text-xs text-center font-medium text-gray-600">{getLabel(score)}</p>

          <div>
            <label className="text-xs text-gray-500 block mb-1">コメント（任意）</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="ご意見・ご感想をお聞かせください"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? '送信中...' : '送信する'}
          </button>
          {error && <p className="text-xs text-red-600 mt-2 text-center" role="alert">送信に失敗しました。時間をおいて再度お試しください。</p>}
        </>
      )}
    </div>
  );
}
