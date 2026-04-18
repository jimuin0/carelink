'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface CronLog {
  id: string;
  job_name: string;
  status: 'success' | 'error' | 'skipped';
  started_at: string;
  duration_ms: number | null;
  processed: number;
  skipped: number;
  error_msg: string | null;
  meta: Record<string, unknown> | null;
}

const STATUS_CONFIG = {
  success: { label: '成功', className: 'bg-emerald-100 text-emerald-700' },
  error:   { label: 'エラー', className: 'bg-red-100 text-red-700' },
  skipped: { label: 'スキップ', className: 'bg-gray-100 text-gray-600' },
};

const JOB_LABELS: Record<string, string> = {
  'booking-reminder':   '予約リマインド',
  'review-request':     'レビュー依頼',
  'daily-summary':      '日次集計',
  'customer-segment':   '顧客セグメント',
  'birthday-coupon':    '誕生日クーポン',
  'favorites-digest':   'お気に入りダイジェスト',
  'flag-reviews':       'レビューフラグ',
  'onboarding-followup':'オンボーディングフォロー',
  'sync-google-ratings':'Googleレーティング同期',
};

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function CronMonitorPage() {
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    let query = supabase
      .from('cron_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200);
    if (selectedJob) query = query.eq('job_name', selectedJob);
    const { data } = await query;
    if (data) setLogs(data);
    setLoading(false);
  }, [selectedJob]);

  useEffect(() => { load(); }, [load]);

  // 直近の各ジョブのステータスサマリー
  const latestByJob = Object.entries(
    logs.reduce<Record<string, CronLog>>((acc, log) => {
      if (!acc[log.job_name]) acc[log.job_name] = log;
      return acc;
    }, {})
  );

  const errorCount = logs.filter(l => l.status === 'error').length;
  const successRate = logs.length > 0
    ? Math.round((logs.filter(l => l.status === 'success').length / logs.length) * 100)
    : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Cron実行監視</h1>
        <button
          type="button"
          onClick={load}
          className="text-sm px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200 transition-colors"
        >
          更新
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">総実行数（30日）</p>
          <p className="text-2xl font-bold text-gray-800">{logs.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">成功率</p>
          <p className={`text-2xl font-bold ${successRate >= 95 ? 'text-emerald-600' : successRate >= 80 ? 'text-amber-500' : 'text-red-600'}`}>
            {successRate}%
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">エラー数</p>
          <p className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {errorCount}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">ジョブ種類</p>
          <p className="text-2xl font-bold text-gray-800">{latestByJob.length}</p>
        </div>
      </div>

      {/* 最新実行ステータス */}
      {latestByJob.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-800">各ジョブの最新実行</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {latestByJob.map(([jobName, log]) => (
              <div key={jobName} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {JOB_LABELS[jobName] || jobName}
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(log.started_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{formatDuration(log.duration_ms)}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[log.status].className}`}>
                    {STATUS_CONFIG[log.status].label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 実行ログ一覧 */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-800">実行ログ</h2>
          <select
            value={selectedJob}
            onChange={(e) => setSelectedJob(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1"
          >
            <option value="">すべてのジョブ</option>
            {Object.entries(JOB_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            実行ログがありません
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">ジョブ</th>
                  <th className="text-left px-4 py-2">実行時刻</th>
                  <th className="text-center px-4 py-2">状態</th>
                  <th className="text-right px-4 py-2">処理数</th>
                  <th className="text-right px-4 py-2">所要時間</th>
                  <th className="text-left px-4 py-2">エラー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className={log.status === 'error' ? 'bg-red-50' : ''}>
                    <td className="px-4 py-2.5 font-medium text-gray-700">
                      {JOB_LABELS[log.job_name] || log.job_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                      {formatDate(log.started_at)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[log.status].className}`}>
                        {STATUS_CONFIG[log.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {log.processed > 0 ? log.processed : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-red-600 max-w-[200px] truncate">
                      {log.error_msg || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
