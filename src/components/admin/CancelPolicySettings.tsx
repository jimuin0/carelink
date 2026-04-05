'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface Policy {
  free_cancel_hours: number;
  late_cancel_rate: number;
  no_show_rate: number;
  policy_text: string;
}

const DEFAULT: Policy = {
  free_cancel_hours: 24,
  late_cancel_rate: 50,
  no_show_rate: 100,
  policy_text: '',
};

export default function CancelPolicySettings({ facilityId }: { facilityId: string }) {
  const [policy, setPolicy] = useState<Policy>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase
        .from('facility_cancel_policies')
        .select('*')
        .eq('facility_id', facilityId)
        .maybeSingle();

      if (data) {
        setPolicy({
          free_cancel_hours: data.free_cancel_hours,
          late_cancel_rate: data.late_cancel_rate,
          no_show_rate: data.no_show_rate,
          policy_text: data.policy_text || '',
        });
      }
      setLoading(false);
    };
    load();
  }, [facilityId]);

  const handleSave = async () => {
    setSaving(true);
    const supabase = createBrowserSupabaseClient();
    await supabase
      .from('facility_cancel_policies')
      .upsert({ facility_id: facilityId, ...policy }, { onConflict: 'facility_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="h-40 bg-gray-50 rounded-lg animate-pulse" />;

  return (
    <div className="bg-white rounded-xl p-6 mt-6">
      <h3 className="text-sm font-bold text-gray-800 mb-4">キャンセルポリシー</h3>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-600 block mb-1">無料キャンセル期限（予約日の何時間前まで）</label>
          <select
            value={policy.free_cancel_hours}
            onChange={(e) => setPolicy({ ...policy, free_cancel_hours: Number(e.target.value) })}
            className="form-input text-sm !w-48"
          >
            <option value={0}>キャンセル不可</option>
            <option value={12}>12時間前まで</option>
            <option value={24}>24時間前まで</option>
            <option value={48}>48時間前まで</option>
            <option value={72}>72時間前まで</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-600 block mb-1">期限後キャンセル料（施術料金の%）</label>
          <select
            value={policy.late_cancel_rate}
            onChange={(e) => setPolicy({ ...policy, late_cancel_rate: Number(e.target.value) })}
            className="form-input text-sm !w-48"
          >
            <option value={0}>0%（無料）</option>
            <option value={30}>30%</option>
            <option value={50}>50%</option>
            <option value={80}>80%</option>
            <option value={100}>100%（全額）</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-600 block mb-1">無断キャンセル料（施術料金の%）</label>
          <select
            value={policy.no_show_rate}
            onChange={(e) => setPolicy({ ...policy, no_show_rate: Number(e.target.value) })}
            className="form-input text-sm !w-48"
          >
            <option value={50}>50%</option>
            <option value={80}>80%</option>
            <option value={100}>100%（全額）</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-600 block mb-1">ポリシー補足（お客様に表示されます）</label>
          <textarea
            value={policy.policy_text}
            onChange={(e) => setPolicy({ ...policy, policy_text: e.target.value })}
            className="form-input text-sm"
            rows={3}
            placeholder="例: 当日キャンセルの場合、施術料金の50%をキャンセル料としていただきます。"
            maxLength={500}
          />
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary !py-2 text-sm">
          {saving ? '保存中...' : saved ? '保存しました' : 'ポリシーを保存'}
        </button>
      </div>
    </div>
  );
}
