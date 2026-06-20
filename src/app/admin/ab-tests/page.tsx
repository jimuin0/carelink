'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

interface Flag {
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
}

interface AbResult {
  experiment_key: string;
  control: { impression?: number; conversion?: number; click?: number; booking?: number; conversion_rate: number };
  treatment: { impression?: number; conversion?: number; click?: number; booking?: number; conversion_rate: number };
  lift: number;
}

export default function AbTestsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [results, setResults] = useState<Record<string, AbResult>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/feature-flags?ab=1');
    const json = res.ok ? await res.json() : { flags: [] };

    const loadedFlags: Flag[] = json.flags ?? [];
    setFlags(loadedFlags);

    // 各フラグのA/B結果を並行取得
    const resultMap: Record<string, AbResult> = {};
    await Promise.all(
      loadedFlags.map(async (f) => {
        const res = await fetch(`/api/ab-test?key=${encodeURIComponent(f.key)}`);
        if (res.ok) {
          const r = await res.json();
          if (r.control || r.treatment) resultMap[f.key] = r;
        }
      })
    );
    setResults(resultMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AdminPageLoading />;

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold">A/Bテスト管理</h1>
        <p className="text-xs text-gray-400 mt-0.5">Feature Flagのロールアウト設定でA/Bテストを実行</p>
      </div>

      <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 text-sm text-sky-800">
        <strong>使い方:</strong>{' '}
        <Link href="/admin/feature-flags" className="underline">Feature Flags</Link>
        でフラグのロールアウト率を1〜99%に設定するとA/Bテストが開始されます。
        コード側で <code className="bg-sky-100 px-1 rounded">trackAbEvent()</code> を呼び出してインプレッション・コンバージョンを計測します。
      </div>

      {flags.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
          実行中のA/Bテストがありません。
          <br />
          <Link href="/admin/feature-flags" className="text-sky-600 hover:underline mt-1 inline-block">
            Feature Flagsでロールアウト設定 →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {flags.map((flag) => {
            const result = results[flag.key];
            const hasData = result && ((result.control.impression ?? 0) > 0 || (result.treatment.impression ?? 0) > 0);

            return (
              <div key={flag.key} className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <code className="font-mono font-bold text-gray-800">{flag.key}</code>
                    {flag.description && <p className="text-xs text-gray-400 mt-0.5">{flag.description}</p>}
                  </div>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                    treatment {flag.rollout_pct}%
                  </span>
                </div>

                {!hasData ? (
                  <p className="text-xs text-gray-400">まだデータがありません</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {(['control', 'treatment'] as const).map((variant) => {
                      const r = result[variant];
                      return (
                        <div key={variant} className={`rounded-lg p-4 ${variant === 'treatment' ? 'bg-sky-50 border border-sky-100' : 'bg-gray-50 border border-gray-100'}`}>
                          <p className={`text-xs font-bold mb-2 ${variant === 'treatment' ? 'text-sky-700' : 'text-gray-600'}`}>
                            {variant === 'treatment' ? '✅ Treatment' : '⬜ Control'}
                          </p>
                          <div className="space-y-1">
                            {[
                              { label: 'インプレッション', key: 'impression' },
                              { label: 'クリック', key: 'click' },
                              { label: 'コンバージョン', key: 'conversion' },
                              { label: '予約', key: 'booking' },
                            ].map(({ label, key }) => {
                              const val = r[key as keyof typeof r];
                              if (!val) return null;
                              return (
                                <div key={key} className="flex justify-between text-xs">
                                  <span className="text-gray-500">{label}</span>
                                  <span className="font-medium text-gray-800">{val}</span>
                                </div>
                              );
                            })}
                            <div className="flex justify-between text-xs border-t border-gray-200 pt-1 mt-1">
                              <span className="font-medium text-gray-700">CV率</span>
                              <span className={`font-bold ${variant === 'treatment' && result.lift > 0 ? 'text-green-600' : 'text-gray-800'}`}>
                                {r.conversion_rate}%
                                {variant === 'treatment' && result.lift !== 0 && (
                                  <span className={`ml-1 text-xs ${result.lift > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    ({result.lift > 0 ? '+' : ''}{result.lift.toFixed(1)}pp)
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
