'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import LoadError from '@/components/admin/LoadError';
import { SbTable, SbThead, SbTh, SbTbody, SbTd, SbPageHeader, SbStatCard } from '@/components/admin/SbUi';
import { CRON_JOB_NAMES, CRON_JOB_LABELS } from '@/lib/cron-jobs';

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

// ジョブ名→表示名／基準リストは SSOT(src/lib/cron-jobs.ts)から導出する。
// cron.yml との整合は cron-jobs-drift テストが CI で保証する（三重管理ドリフト検知）。
const JOB_LABELS: Record<string, string> = CRON_JOB_LABELS;

// cron.yml で定義されている定期ジョブ（`各ジョブの最新実行`の常時表示対象）。
// 高頻度ジョブ（webhook-retry 等）がログを埋め尽くしても、ここに列挙した
// 低頻度ジョブ（週次等）の最新1件を確実に個別取得して表示するための基準リスト。
const EXPECTED_JOBS: string[] = CRON_JOB_NAMES;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

interface Summary {
  total: number;
  errors: number;
  successes: number;
}

export default function CronMonitorPage() {
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [jobsLatest, setJobsLatest] = useState<CronLog[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, errors: 0, successes: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string>('');

  // 各非同期フェッチに世代番号を持たせ、古いレスポンスが後から解決しても state を
  // 上書きしないようにする（フィルタ変更や「更新」連打による並行 load のレース対策）。
  const logsGenRef = useRef(0);
  const sideGenRef = useRef(0);

  // 実行ログ一覧（selectedJob で絞り込み・最新200件）。フィルタ変更のたびに
  // これだけを再取得する（per-job フェッチやサマリーは selectedJob と無関係なので
  // 再実行しない＝無駄な N+1 を出さない）。
  const loadLogs = useCallback(async () => {
    const gen = ++logsGenRef.current;
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    let query = supabase
      .from('cron_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200);
    if (selectedJob) query = query.eq('job_name', selectedJob);
    const { data, error } = await query;
    if (gen !== logsGenRef.current) return; // 古いレスポンスは無視
    if (error) { setLoadError(true); setLoading(false); return; }
    setLogs(data ?? []);
    setLoading(false);
  }, [selectedJob]);

  // サマリーカード（総実行数・成功率・エラー数）とジョブ別最新実行は selectedJob に
  // 依存しない「全体」の状態。フィルタ変更では再実行せず、マウント時と「更新」ボタン
  // でのみ取得する。
  const loadSideData = useCallback(async () => {
    const gen = ++sideGenRef.current;
    const supabase = createBrowserSupabaseClient();
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    // サマリーは実データの「直近30日」件数を count(exact, head) で正確に取得する
    // （旧実装は最新200件の長さを「総実行数（30日）」と称していたが、高頻度ジョブが
    // 200件を占有するため実際は直近1〜2日分に過ぎず、ラベルが事実と乖離していた）。
    const [totalRes, errorRes, successRes] = await Promise.all([
      supabase.from('cron_logs').select('id', { count: 'exact', head: true }).gte('started_at', since),
      supabase.from('cron_logs').select('id', { count: 'exact', head: true }).gte('started_at', since).eq('status', 'error'),
      supabase.from('cron_logs').select('id', { count: 'exact', head: true }).gte('started_at', since).eq('status', 'success'),
    ]);
    if (gen === sideGenRef.current && !totalRes.error && !errorRes.error && !successRes.error) {
      setSummary({ total: totalRes.count ?? 0, errors: errorRes.count ?? 0, successes: successRes.count ?? 0 });
    }

    // 各ジョブの最新実行を「ジョブごとに1件」確実に取得する。最新200件の寄せ集めだと、
    // 高頻度ジョブ（webhook-retry 等）がその200件を占有し、週次など低頻度ジョブが
    // 画面から消える（DBには記録があるのに表示されない）。頻度に依存しないよう、
    // 対象ジョブ名を「cron.yml 定義（EXPECTED_JOBS）＋ 直近ログに現れたジョブ」の
    // 和集合で求め、各ジョブの最新1件を idx_cron_logs_job_started 経由で個別取得する。
    const { data: recentNames, error: namesErr } = await supabase
      .from('cron_logs')
      .select('job_name')
      .order('started_at', { ascending: false })
      .limit(500);
    // 直近ログの取得に失敗しても、cron.yml 定義（EXPECTED_JOBS）は必ず表示対象にする
    // （取得失敗を空状態に偽装せず、既知ジョブは確実に表示し続ける）。
    const seen = namesErr ? [] : (recentNames ?? []).map((r: { job_name: string }) => r.job_name);
    const jobNames = Array.from(new Set<string>([...EXPECTED_JOBS, ...seen]));
    const latestResults = await Promise.all(
      jobNames.map(async (job) => {
        const { data: r, error: rErr } = await supabase
          .from('cron_logs')
          .select('*')
          .eq('job_name', job)
          .order('started_at', { ascending: false })
          .limit(1);
        // 個別ジョブの取得失敗はそのジョブを除外（他ジョブの表示は継続）。
        if (rErr) return null;
        return (r && r.length ? (r[0] as CronLog) : null);
      })
    );
    if (gen !== sideGenRef.current) return; // 古いレスポンスは無視
    const latest = (latestResults.filter(Boolean) as CronLog[])
      .sort((a, b) => (a.started_at === b.started_at ? 0 : b.started_at.localeCompare(a.started_at)));
    setJobsLatest(latest);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadLogs().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadLogs]);

  useEffect(() => {
    loadSideData().catch(() => { /* サマリー/ジョブ一覧の失敗は実行ログ一覧の表示を妨げない */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    loadLogs().catch(() => { setLoadError(true); setLoading(false); });
    loadSideData().catch(() => {});
  }, [loadLogs, loadSideData]);

  const latestByJob: [string, CronLog][] = jobsLatest.map((log) => [log.job_name, log]);

  const successRate = summary.total > 0 ? Math.round((summary.successes / summary.total) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <SbPageHeader
        title="Cron実行監視"
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            className="text-sm px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200 transition-colors"
          >
            更新
          </button>
        }
      />

      {/* サマリーカード（常に全体・selectedJob の絞り込みに関わらず一定） */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SbStatCard label="総実行数（30日）" value={summary.total} />
        <SbStatCard label="成功率（30日）" value={`${successRate}%`} accent={successRate >= 95 ? 'emerald' : successRate >= 80 ? 'amber' : 'rose'} />
        <SbStatCard label="エラー数（30日）" value={summary.errors} accent={summary.errors > 0 ? 'rose' : 'gray'} />
        <SbStatCard label="ジョブ種類" value={latestByJob.length} />
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
            {jobsLatest.map(({ job_name }) => (
              <option key={job_name} value={job_name}>{JOB_LABELS[job_name] || job_name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : loadError ? (
          <div className="p-4"><LoadError onRetry={handleRefresh} message="実行ログの読み込みに失敗しました" /></div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            実行ログがありません
          </div>
        ) : (
          <SbTable>
            <SbThead>
              <SbTh>ジョブ</SbTh>
              <SbTh>実行時刻</SbTh>
              <SbTh align="center">状態</SbTh>
              <SbTh align="right">処理数</SbTh>
              <SbTh align="right">所要時間</SbTh>
              <SbTh>エラー</SbTh>
            </SbThead>
            <SbTbody>
              {logs.map((log) => (
                <tr key={log.id} className={log.status === 'error' ? 'bg-red-50' : ''}>
                  <SbTd className="font-medium text-gray-700">
                    {JOB_LABELS[log.job_name] || log.job_name}
                  </SbTd>
                  <SbTd className="text-gray-500 whitespace-nowrap">
                    {formatDate(log.started_at)}
                  </SbTd>
                  <SbTd align="center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[log.status].className}`}>
                      {STATUS_CONFIG[log.status].label}
                    </span>
                  </SbTd>
                  <SbTd align="right" className="text-gray-600">
                    {log.processed > 0 ? log.processed : '-'}
                  </SbTd>
                  <SbTd align="right" className="text-gray-400">
                    {formatDuration(log.duration_ms)}
                  </SbTd>
                  <SbTd className="text-xs text-red-600 max-w-[200px] truncate">
                    {log.error_msg || '-'}
                  </SbTd>
                </tr>
              ))}
            </SbTbody>
          </SbTable>
        )}
      </div>
    </div>
  );
}
