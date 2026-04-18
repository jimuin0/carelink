'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function EditStaffPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [lineWorksChannelId, setLineWorksChannelId] = useState('');
  const [lineWorksNotifyAll, setLineWorksNotifyAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      const { data } = await supabase.from('staff_profiles').select('*').eq('id', params.id).eq('facility_id', membership.facility_id).single();
      if (data) {
        setName(data.name || '');
        setPosition(data.position || '');
        setBio(data.bio || '');
        setSpecialties((data.specialties || []).join(', '));
        setYearsExperience(data.years_experience?.toString() || '');
        setInstagramUrl(data.instagram_url || '');
        setLineWorksChannelId(data.line_works_channel_id || '');
        setLineWorksNotifyAll(data.line_works_notify_all || false);
      }
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [params.id]);

  const handleSave = async () => {
    if (saving || !name || !facilityId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/staff/${params.id}?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          position: position || null,
          bio: bio || null,
          specialties: specialties ? specialties.split(',').map((s: string) => s.trim()) : [],
          years_experience: yearsExperience ? parseInt(yearsExperience) : null,
          instagram_url: instagramUrl || null,
          line_works_channel_id: lineWorksChannelId || null,
          line_works_notify_all: lineWorksNotifyAll,
        }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
      } else {
        setToast({ type: 'success', message: '保存しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="bg-white rounded-xl p-6 animate-pulse"><div className="h-6 bg-gray-200 rounded w-1/3" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">スタッフ編集</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label htmlFor="staff-name" className="form-label">名前 <span className="text-red-500">*</span></label>
          <input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className="form-input" maxLength={50} />
        </div>
        <div>
          <label htmlFor="staff-position" className="form-label">役職</label>
          <input id="staff-position" value={position} onChange={(e) => setPosition(e.target.value)} className="form-input" placeholder="店長、スタイリスト等" maxLength={50} />
        </div>
        <div>
          <label htmlFor="staff-bio" className="form-label">自己紹介</label>
          <textarea id="staff-bio" value={bio} onChange={(e) => setBio(e.target.value)} className="form-input" rows={4} maxLength={500} />
        </div>
        <div>
          <label htmlFor="staff-specialties" className="form-label">得意分野（カンマ区切り）</label>
          <input id="staff-specialties" value={specialties} onChange={(e) => setSpecialties(e.target.value)} className="form-input" placeholder="カット, カラー, パーマ" maxLength={200} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="staff-years" className="form-label">経験年数</label>
            <input id="staff-years" type="number" value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} className="form-input" />
          </div>
          <div>
            <label htmlFor="staff-instagram" className="form-label">Instagram URL</label>
            <input id="staff-instagram" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className="form-input" maxLength={200} />
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">LINE Works 通知設定</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="staff-lw-channel" className="form-label">LINE Works チャンネルID</label>
              <input
                id="staff-lw-channel"
                value={lineWorksChannelId}
                onChange={(e) => setLineWorksChannelId(e.target.value)}
                className="form-input"
                placeholder="例: 12345678901234567"
              />
              <p className="text-xs text-gray-400 mt-1">LINE Works 管理コンソールのBot設定から確認できます</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={lineWorksNotifyAll}
                onChange={(e) => setLineWorksNotifyAll(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">担当外の予約（全件）も通知を受け取る</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push('/admin/staff')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
