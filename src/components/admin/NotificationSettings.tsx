'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import LoadError from '@/components/admin/LoadError';

interface Settings {
  push_on_new_booking: boolean;
  push_on_cancel: boolean;
  push_on_review: boolean;
  email_daily_summary: boolean;
  email_weekly_report: boolean;
}

const DEFAULT: Settings = {
  push_on_new_booking: true,
  push_on_cancel: true,
  push_on_review: true,
  email_daily_summary: false,
  email_weekly_report: true,
};

const LABELS: Record<keyof Settings, string> = {
  push_on_new_booking: '新規予約（Push通知）',
  push_on_cancel: 'キャンセル（Push通知）',
  push_on_review: '口コミ投稿（Push通知）',
  email_daily_summary: '日次売上サマリー（メール）',
  email_weekly_report: '週次レポート（メール）',
};

export default function NotificationSettings({ facilityId }: { facilityId: string }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data, error } = await supabase
        .from('facility_notification_settings')
        .select('*')
        .eq('facility_id', facilityId)
        .maybeSingle();

      if (error) { setLoadError(true); setLoading(false); return; }
      if (data) {
        setSettings({
          push_on_new_booking: data.push_on_new_booking,
          push_on_cancel: data.push_on_cancel,
          push_on_review: data.push_on_review,
          email_daily_summary: data.email_daily_summary,
          email_weekly_report: data.email_weekly_report,
        });
      }
      setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleToggle = async (key: keyof Settings) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    setSaving(true);

    const supabase = createBrowserSupabaseClient();
    await supabase
      .from('facility_notification_settings')
      .upsert({
        facility_id: facilityId,
        ...newSettings,
      }, { onConflict: 'facility_id' });

    setSaving(false);
  };

  if (loading) return <div className="h-40 bg-gray-50 rounded-lg animate-pulse" />;

  // 取得失敗時はトグルを描画しない（DEFAULT値を upsert で保存して実設定を上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div className="bg-white rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-800 mb-4">通知設定</h3>
        <LoadError onRetry={load} message="通知設定の読み込みに失敗しました" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-sm font-bold text-gray-800 mb-4">通知設定</h3>
      <div className="space-y-3">
        {(Object.keys(LABELS) as (keyof Settings)[]).map((key) => (
          <label key={key} className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700">{LABELS[key]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings[key]}
              onClick={() => handleToggle(key)}
              disabled={saving}
              className={`relative w-11 h-6 rounded-full transition-colors ${settings[key] ? 'bg-sky-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${settings[key] ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        ))}
      </div>
      {saving && <p className="text-xs text-gray-400 mt-2">保存中...</p>}
    </div>
  );
}
