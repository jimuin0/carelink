'use client';

import { useState } from 'react';

interface FormField {
  id: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'boolean';
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

interface IntakeTemplate {
  id: string;
  title: string;
  description?: string | null;
  fields: FormField[];
}

interface Props {
  facilityId: string;
  facilityName: string;
  bookingId?: string;
  template: IntakeTemplate;
  onSubmitted?: () => void;
}

export default function IntakeForm({ facilityId, facilityName, bookingId, template, onSubmitted }: Props) {
  const [customerName, setCustomerName] = useState('');
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (fieldId: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 必須フィールドチェック
    const missing = template.fields.filter(
      (f) => f.required && (responses[f.id] === undefined || responses[f.id] === '' || responses[f.id] === null)
    );
    if (!customerName.trim()) {
      setError('お名前を入力してください');
      return;
    }
    if (missing.length > 0) {
      setError(`未回答の必須項目があります: ${missing.map(f => f.label).join('、')}`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          template_id: template.id,
          facility_id: facilityId,
          booking_id: bookingId,
          customer_name: customerName,
          responses,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '送信に失敗しました');
        return;
      }
      setDone(true);
      onSubmitted?.();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center space-y-3">
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-bold text-emerald-800 text-lg">問診票を送信しました</p>
        <p className="text-sm text-emerald-700">
          {facilityName}でお待ちしています。ご来院の際にお申し付けください。
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-sky-50 border-b border-sky-100 px-5 py-4">
        <h2 className="text-lg font-bold text-gray-900">{template.title}</h2>
        {template.description && (
          <p className="text-sm text-gray-600 mt-1">{template.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          ご来院前にご記入いただくと、スムーズに施術を開始できます。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-5">
        {/* お名前 */}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">
            お名前 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="山田 花子"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        {/* 動的フィールド */}
        {template.fields.map((field) => (
          <div key={field.id}>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {field.type === 'text' && (
              <input
                type="text"
                value={(responses[field.id] as string) || ''}
                onChange={(e) => setValue(field.id, e.target.value)}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                value={(responses[field.id] as string) || ''}
                onChange={(e) => setValue(field.id, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
                maxLength={2000}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
              />
            )}

            {field.type === 'select' && field.options && (
              <select
                value={(responses[field.id] as string) || ''}
                onChange={(e) => setValue(field.id, e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
              >
                <option value="">選択してください</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}

            {field.type === 'radio' && field.options && (
              <div className="space-y-2">
                {field.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={field.id}
                      value={opt}
                      checked={responses[field.id] === opt}
                      onChange={() => setValue(field.id, opt)}
                      className="text-sky-500"
                    />
                    <span className="text-sm text-gray-700">{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {field.type === 'boolean' && (
              <div className="flex gap-4">
                {['はい', 'いいえ'].map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={field.id}
                      value={opt}
                      checked={responses[field.id] === opt}
                      onChange={() => setValue(field.id, opt)}
                      className="text-sky-500"
                    />
                    <span className="text-sm text-gray-700">{opt}</span>
                  </label>
                ))}
              </div>
            )}

            {field.type === 'date' && (
              <input
                type="date"
                value={(responses[field.id] as string) || ''}
                onChange={(e) => setValue(field.id, e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            )}
          </div>
        ))}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-sky-600 text-white font-bold py-3 rounded-xl text-sm hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? '送信中...' : '問診票を送信する'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          送信後は施術前に担当スタッフが内容を確認します
        </p>
      </form>
    </div>
  );
}
