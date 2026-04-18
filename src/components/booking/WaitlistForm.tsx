'use client';

import { useState } from 'react';

interface Props {
  facilityId: string;
  facilityName: string;
  date: string;         // YYYY-MM-DD
  startTime: string;    // HH:MM
  endTime: string;      // HH:MM
  menuId?: string;
  staffId?: string;
  onSuccess?: () => void;
  onClose?: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

export default function WaitlistForm({
  facilityId, facilityName, date, startTime, endTime, // eslint-disable-line @typescript-eslint/no-unused-vars
  menuId, staffId, onSuccess, onClose,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          facility_id: facilityId,
          menu_id: menuId,
          staff_id: staffId,
          date,
          start_time: startTime,
          end_time: endTime,
          customer_name: name,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登録に失敗しました');
        return;
      }
      setDone(true);
      onSuccess?.();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center space-y-2">
        <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-bold text-emerald-800">キャンセル待ちに登録しました</p>
        <p className="text-sm text-emerald-700">
          {formatDate(date)} {startTime}〜のキャンセルが出た場合、{email} にご連絡します。
        </p>
        <button type="button" onClick={onClose} className="mt-2 text-sm text-emerald-600 underline hover:text-emerald-700">
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-bold text-amber-800">
            {formatDate(date)} {startTime}〜 は満席です
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            キャンセル待ちに登録すると、空きが出た際にメールでお知らせします
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">お名前 <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="山田 花子"
            required
            maxLength={50}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">メールアドレス <span className="text-red-500">*</span></label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            required
            maxLength={254}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <p className="text-xs text-gray-400 mt-1">空きが出た際にご連絡します（通知から48時間有効）</p>
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !name.trim() || !email.trim()}
            className="flex-1 bg-amber-500 text-white font-bold py-2.5 rounded-lg text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '登録中...' : 'キャンセル待ちに登録する'}
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              閉じる
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
