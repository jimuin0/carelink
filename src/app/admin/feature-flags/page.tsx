'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  updated_at: string;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase
      .from('feature_flags')
      .select('id, key, enabled, rollout_pct, description, updated_at')
      .order('key');
    if (data) setFlags(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateFlag = async (id: string, updates: Partial<Pick<FeatureFlag, 'enabled' | 'rollout_pct'>>) => {
    setSaving(id);
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.from('feature_flags').update(updates).eq('id', id);
    if (error) {
      setToast({ type: 'error', message: '更新に失敗しました' });
    } else {
      setToast({ type: 'success', message: '更新しました' });
      load();
    }
    setSaving(null);
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Feature Flags</h1>
        <button onClick={load} className="text-sm px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200">更新</button>
      </div>

      <p className="text-sm text-gray-500">
        機能の段階的リリース・緊急停止スイッチを管理します。変更後は反映まで5分程度かかります（サーバーキャッシュ）。
      </p>

      {loading ? (
        <div className="py-12 text-center">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
          {flags.map((flag) => (
            <div key={flag.id} className={`flex items-center gap-4 px-4 py-3.5 ${saving === flag.id ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono font-bold text-gray-800">{flag.key}</code>
                  {flag.enabled && flag.rollout_pct > 0 && flag.rollout_pct < 100 && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                      {flag.rollout_pct}% ロールアウト
                    </span>
                  )}
                </div>
                {flag.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{flag.description}</p>
                )}
              </div>

              {/* ロールアウト割合 */}
              <select
                value={flag.rollout_pct}
                onChange={(e) => updateFlag(flag.id, { rollout_pct: parseInt(e.target.value, 10) })}
                disabled={saving === flag.id || !flag.enabled}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 w-20"
              >
                {[0, 1, 5, 10, 25, 50, 75, 100].map((v) => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </select>

              {/* トグル */}
              <button
                onClick={() => updateFlag(flag.id, { enabled: !flag.enabled, rollout_pct: !flag.enabled ? 100 : 0 })}
                disabled={saving === flag.id}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none ${
                  flag.enabled ? 'bg-emerald-500' : 'bg-gray-300'
                } disabled:opacity-50`}
                aria-label={flag.enabled ? 'フラグを無効化' : 'フラグを有効化'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    flag.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
