'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getRecaptchaToken } from '@/lib/recaptcha-client';

interface Treatment {
  name: string;
  description: string;
  icon: string;
}

interface SuggestResult {
  summary: string;
  recommended_treatments: Treatment[];
  search_keywords: string[];
  caution: string | null;
  tips: string[];
}

const SYMPTOM_EXAMPLES = [
  '肩こり・首の痛み',
  '慢性腰痛',
  '頭痛・偏頭痛',
  '膝の痛み',
  '疲労感・倦怠感',
  '不眠・睡眠障害',
  '手足のしびれ',
  '生理痛・月経不順',
];

export default function SymptomsPage() {
  const [symptoms, setSymptoms] = useState('');
  const [prefecture, setPrefecture] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!symptoms.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const recaptchaToken = await getRecaptchaToken('symptoms_suggest');
      const res = await fetch('/api/symptoms/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptoms: symptoms.trim(),
          prefecture: prefecture || undefined,
          ...(recaptchaToken ? { recaptcha_token: recaptchaToken } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data.result);
      } else {
        const e = await res.json().catch(() => null);
        setError(e?.error ?? 'エラーが発生しました');
      }
    } catch {
      // 通信失敗（オフライン等）でも無限ローディングにせず、再試行できるよう明示する
      setError('通信に失敗しました。通信状況をご確認のうえ、再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        {/* ヘッダー */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto text-3xl">🔍</div>
          <h1 className="text-2xl font-bold text-gray-800">AI症状チェッカー</h1>
          <p className="text-sm text-gray-500">お悩みの症状を入力すると、適切な治療法と近くの施設を提案します</p>
        </div>

        {/* 入力フォーム */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div>
            <label htmlFor="symptoms-input" className="block text-sm font-medium text-gray-700 mb-2">症状・お悩みを入力</label>
            <textarea
              id="symptoms-input"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              rows={4}
              maxLength={1000}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
              placeholder="例: 1週間前から右肩が重く、首を回すと痛みがある。デスクワークが多い。"
            />
            <p className="text-xs text-gray-400 mt-1">{symptoms.length}/1000文字</p>
          </div>

          <div>
            <label htmlFor="prefecture-input" className="block text-sm font-medium text-gray-700 mb-2">都道府県（任意）</label>
            <input
              id="prefecture-input"
              value={prefecture}
              onChange={(e) => setPrefecture(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="大阪府"
            />
          </div>

          {/* よくある症状 */}
          <div>
            <p className="text-xs text-gray-500 mb-2">よくある症状から選ぶ</p>
            <div className="flex flex-wrap gap-2">
              {SYMPTOM_EXAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSymptoms(s)}
                  className="text-xs px-3 py-1.5 bg-sky-50 text-sky-700 rounded-full hover:bg-sky-100 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!symptoms.trim() || loading}
            className="w-full py-3 bg-sky-600 text-white rounded-xl font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                AI が分析中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a5 5 0 01-7.072 0l-.347-.347z" />
                </svg>
                症状を分析する
              </>
            )}
          </button>
        </div>

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {/* 結果 */}
        {result && (
          <div className="space-y-4">
            {/* 注意事項（緊急性） */}
            {result.caution && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <span className="text-xl shrink-0">⚠️</span>
                <div>
                  <p className="text-sm font-medium text-amber-800">受診前のご注意</p>
                  <p className="text-sm text-amber-700 mt-0.5">{result.caution}</p>
                </div>
              </div>
            )}

            {/* サマリー */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-800 mb-2">症状の概要</h2>
              <p className="text-sm text-gray-600">{result.summary}</p>
            </div>

            {/* おすすめ治療法 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-800 mb-3">おすすめの治療法</h2>
              <div className="space-y-3">
                {result.recommended_treatments.map((t, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center text-xl shrink-0">{t.icon}</div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 施設を探す */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-bold text-gray-800 mb-3">近くの施設を探す</h2>
              <div className="flex flex-wrap gap-2">
                {result.search_keywords.map((kw) => (
                  <Link
                    key={kw}
                    // /search が読むクエリパラメータは keyword/area（q/pref ではない）。旧実装は
                    // 存在しないパラメータ名を使っており絞り込みが無視され全件表示になっていた
                    // （実データ確認: /search?q=...&pref=... は無指定と同じ件数を返していた）。
                    href={`/search?keyword=${encodeURIComponent(kw)}${prefecture ? `&area=${encodeURIComponent(prefecture)}` : ''}`}
                    className="inline-flex items-center gap-1 px-4 py-2 bg-sky-600 text-white text-sm rounded-full hover:bg-sky-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {kw}
                  </Link>
                ))}
              </div>
            </div>

            {/* セルフケア */}
            {result.tips.length > 0 && (
              <div className="bg-green-50 rounded-2xl border border-green-100 p-5">
                <h2 className="font-bold text-green-800 mb-3">🌿 セルフケアのヒント</h2>
                <ul className="space-y-2">
                  {result.tips.map((tip, i) => (
                    <li key={i} className="flex gap-2 text-sm text-green-700">
                      <span className="shrink-0 mt-0.5">✓</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-400 text-center">
              ※ AIによる一般的な情報提供であり、医療診断ではありません。症状が重い場合は医療機関を受診してください。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
