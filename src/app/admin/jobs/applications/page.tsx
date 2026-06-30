'use client';

import { useState, useEffect } from 'react';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

type Application = {
  id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  cover_letter: string | null;
  status: string;
  referral_fee_yen: number | null;
  hired_at: string | null;
  fee_paid_at: string | null;
  created_at: string;
  job_postings?: { title: string } | null;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '新着', color: 'bg-blue-100 text-blue-700' },
  reviewing: { label: '審査中', color: 'bg-yellow-100 text-yellow-700' },
  interview_scheduled: { label: '面接予定', color: 'bg-purple-100 text-purple-700' },
  interview_done: { label: '面接済', color: 'bg-orange-100 text-orange-700' },
  offer_made: { label: 'オファー済', color: 'bg-sky-100 text-sky-700' },
  hired: { label: '採用決定', color: 'bg-green-100 text-green-700' },
  rejected: { label: '不採用', color: 'bg-red-100 text-red-700' },
  withdrawn: { label: '辞退', color: 'bg-gray-100 text-gray-700' },
};

export default function JobApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Application | null>(null);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = () => {
    setLoadError(false);
    setLoading(true);
    fetch('/api/admin/job-applications')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setApplications(d.applications || []); setLoading(false); })
      // 読み込み失敗を「応募0件」と誤表示しないよう、エラー状態を保持して LoadError を出す。
      .catch(() => { setLoadError(true); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: string, referralFee?: number) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/job-applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, referral_fee_yen: referralFee }),
      });
      if (res.ok) {
        const data = await res.json();
        setApplications((prev) => prev.map((a) => a.id === id ? data.application : a));
        setSelected(data.application);
        // 採用・紹介手数料の登録が成功したことを明示（無音成功で誤認させない）。
        setToast({ type: 'success', message: status === 'hired' ? '採用情報を保存しました' : 'ステータスを更新しました' });
      } else {
        // 従来は失敗時に何も起きず、採用・手数料登録が失敗しても成功と誤認していた。
        const e = await res.json().catch(() => null);
        setToast({ type: 'error', message: e?.error || '更新に失敗しました。時間をおいて再度お試しください' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setUpdating(false);
    }
  };

  const stats = {
    total: applications.length,
    reviewing: applications.filter((a) => ['reviewing', 'interview_scheduled', 'interview_done', 'offer_made'].includes(a.status)).length,
    hired: applications.filter((a) => a.status === 'hired').length,
    totalFees: applications.filter((a) => a.status === 'hired').reduce((sum, a) => sum + (a.referral_fee_yen || 0), 0),
  };

  return (
    <div className="max-w-5xl space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">求人応募管理</h1>
        <p className="text-sm text-gray-500 mt-1">人材紹介連動 — 採用時に紹介手数料が発生します</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: '総応募数', value: stats.total },
          { label: '選考中', value: stats.reviewing },
          { label: '採用決定', value: stats.hired },
          { label: '累計手数料', value: `¥${stats.totalFees.toLocaleString()}` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Application list */}
        <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b font-semibold text-gray-900">応募一覧</div>
          {loading ? (
            <div className="p-8 text-center text-gray-400">読み込み中...</div>
          ) : loadError ? (
            <div className="p-6"><LoadError onRetry={load} message="応募の読み込みに失敗しました" /></div>
          ) : applications.length === 0 ? (
            <div className="p-8 text-center text-gray-400">まだ応募がありません</div>
          ) : (
            <div className="divide-y">
              {applications.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelected(a)}
                  className={`w-full text-left px-6 py-4 hover:bg-gray-50 transition-colors ${selected?.id === a.id ? 'bg-sky-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-gray-900">{a.applicant_name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {a.job_postings?.title && <span>{a.job_postings.title} • </span>}
                        {new Date(a.created_at).toLocaleDateString('ja-JP')}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_LABELS[a.status]?.color || 'bg-gray-100'}`}>
                      {STATUS_LABELS[a.status]?.label || a.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-xl border p-6">
          {!selected ? (
            <div className="text-center text-gray-400 text-sm py-8">応募を選択してください</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900">{selected.applicant_name}</h3>
                <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                  <div>{selected.applicant_email}</div>
                  {selected.applicant_phone && <div>{selected.applicant_phone}</div>}
                </div>
              </div>

              {selected.cover_letter && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">志望動機</div>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selected.cover_letter}</p>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">ステータス変更</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(STATUS_LABELS).map(([value, { label, color }]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={updating || selected.status === value}
                      onClick={() => updateStatus(selected.id, value)}
                      className={`text-xs px-2 py-1 rounded-full transition-colors ${
                        selected.status === value ? color + ' font-bold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      } disabled:opacity-50`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {selected.status === 'hired' && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">紹介手数料（円）</div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      defaultValue={selected.referral_fee_yen || ''}
                      placeholder="例: 300000"
                      className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') return; // 空欄でフォーカスアウトは無操作（保存しない）
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 0) {
                          updateStatus(selected.id, 'hired', val);
                        } else {
                          // 不正値を無音で握り潰さず明示する。
                          setToast({ type: 'error', message: '紹介手数料は0以上の数値で入力してください' });
                        }
                      }}
                    />
                    <span className="text-sm text-gray-500 self-center">円</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">採用月の翌月末に請求書を発行します</p>
                </div>
              )}

              {selected.hired_at && (
                <div className="text-xs text-gray-500">
                  採用日: {new Date(selected.hired_at).toLocaleDateString('ja-JP')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
