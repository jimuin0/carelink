'use client';

import { useEffect, useState } from 'react';
import { useLiff } from '@/hooks/useLiff';

type PointLog = {
  id: string;
  points: number;
  reason: string;
  created_at: string;
};

function LiffLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">読み込み中...</p>
      </div>
    </div>
  );
}
function LiffError({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <p role="alert" className="text-red-500 text-sm">{message}</p>
    </div>
  );
}
function LiffNotLinked() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-4">
        <p className="text-2xl">🔗</p>
        <p className="font-bold text-gray-900">LINE連携が必要です</p>
        <p className="text-sm text-gray-500">マイページの設定からLINE連携を行ってください。</p>
        <a href="/mypage/settings" className="inline-block bg-[#06C755] text-white px-6 py-2.5 rounded-full text-sm font-bold">設定ページへ</a>
      </div>
    </div>
  );
}

export default function LiffPointsPage() {
  const liff = useLiff();
  const [logs, setLogs] = useState<PointLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (liff.status !== 'ready') return;
    setLoading(true);
    fetch('/api/liff/points', {
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setLogs(d.logs || []); setTotal(d.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [liff]);

  if (liff.status === 'loading') return <LiffLoading />;
  if (liff.status === 'error') return <LiffError message={liff.message} />;
  if (liff.status === 'not_linked') return <LiffNotLinked />;

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* 合計ポイント */}
      <div className="bg-gradient-to-br from-sky-500 to-sky-600 rounded-2xl p-6 text-white text-center mb-6">
        <p className="text-sm opacity-80">保有ポイント</p>
        <p className="text-4xl font-bold mt-1">{total.toLocaleString()}<span className="text-lg ml-1">pt</span></p>
        <p className="text-xs opacity-70 mt-1">{liff.data.display_name} さん</p>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-3">履歴</h2>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">読み込み中...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">ポイント履歴はありません</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-white rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-800">{log.reason}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(log.created_at).toLocaleDateString('ja-JP')}
                </p>
              </div>
              <span className={`text-base font-bold ${log.points >= 0 ? 'text-sky-600' : 'text-red-500'}`}>
                {log.points >= 0 ? '+' : ''}{log.points}pt
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
