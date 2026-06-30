'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function AccountingPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [format, setFormat] = useState<'freee' | 'mf' | 'generic'>('freee');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single()
        .then(({ data }) => { if (data) setFacilityId(data.facility_id); });
    });
  }, []);

  const handleExport = () => {
    if (!facilityId) return;
    const url = `/api/admin/accounting-export?facility_id=${facilityId}&format=${format}&from=${from}&to=${to}`;
    const a = document.createElement('a');
    a.href = url;
    a.click();
  };

  const FORMAT_INFO = {
    freee: {
      label: 'freee（取引インポート）',
      desc: '取引日・勘定科目・税区分・金額を含むfreee対応CSV',
      icon: '🟢',
    },
    mf: {
      label: 'MFクラウド会計（仕訳インポート）',
      desc: '借方/貸方勘定科目・税区分・摘要を含むMF対応CSV',
      icon: '🔵',
    },
    generic: {
      label: '汎用CSV（予約一覧）',
      desc: '予約ID・顧客名・メニュー・金額・ステータスの一覧',
      icon: '📊',
    },
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">会計ソフト連携</h1>
        <p className="text-xs text-gray-400 mt-0.5">確定・完了した予約データを会計ソフト用CSVでエクスポート</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        {/* フォーマット選択 */}
        <div>
          <p className="block text-sm font-medium text-gray-700 mb-3">出力形式</p>
          <div className="space-y-2">
            {(Object.entries(FORMAT_INFO) as [keyof typeof FORMAT_INFO, typeof FORMAT_INFO[keyof typeof FORMAT_INFO]][]).map(([key, info]) => (
              <label key={key} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                format === key ? 'border-sky-400 bg-sky-50' : 'border-gray-100 hover:border-gray-200'
              }`}>
                <input type="radio" value={key} checked={format === key} onChange={() => setFormat(key)}
                  className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{info.icon} {info.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{info.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 期間選択 */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ac-from" className="block text-xs text-gray-500 mb-1">開始日</label>
            <input id="ac-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="ac-to" className="block text-xs text-gray-500 mb-1">終了日</label>
            <input id="ac-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        {/* エクスポートボタン */}
        <button type="button" onClick={handleExport} disabled={!facilityId}
          className="btn-primary w-full !py-3 gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSVをダウンロード
        </button>
      </div>

      {/* 注意事項 */}
      <div className="bg-amber-50 rounded-xl p-4 text-xs text-amber-800 space-y-1">
        <p><strong>注意事項：</strong></p>
        <p>• 出力対象は「確定」「完了」ステータスの予約のみです</p>
        <p>• 消費税率は一律10%で計算しています</p>
        <p>• 実際の申告前に税理士・会計士にご確認ください</p>
        <p>• freee / MFの仕様変更により形式が異なる場合があります</p>
      </div>
    </div>
  );
}
