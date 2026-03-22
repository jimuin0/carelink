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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).single();
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
      }
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [params.id]);

  const handleSave = async () => {
    if (saving || !name || !facilityId) return;
    setSaving(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase
      .from('staff_profiles')
      .update({
        name,
        position: position || null,
        bio: bio || null,
        specialties: specialties ? specialties.split(',').map((s) => s.trim()) : [],
        years_experience: yearsExperience ? parseInt(yearsExperience) : null,
        instagram_url: instagramUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('facility_id', facilityId);

    if (error) {
      setToast({ type: 'error', message: '保存に失敗しました' });
    } else {
      setToast({ type: 'success', message: '保存しました' });
    }
    setSaving(false);
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
          <input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className="form-input" />
        </div>
        <div>
          <label htmlFor="staff-position" className="form-label">役職</label>
          <input id="staff-position" value={position} onChange={(e) => setPosition(e.target.value)} className="form-input" placeholder="店長、スタイリスト等" />
        </div>
        <div>
          <label htmlFor="staff-bio" className="form-label">自己紹介</label>
          <textarea id="staff-bio" value={bio} onChange={(e) => setBio(e.target.value)} className="form-input" rows={4} />
        </div>
        <div>
          <label htmlFor="staff-specialties" className="form-label">得意分野（カンマ区切り）</label>
          <input id="staff-specialties" value={specialties} onChange={(e) => setSpecialties(e.target.value)} className="form-input" placeholder="カット, カラー, パーマ" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="staff-years" className="form-label">経験年数</label>
            <input id="staff-years" type="number" value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} className="form-input" />
          </div>
          <div>
            <label htmlFor="staff-instagram" className="form-label">Instagram URL</label>
            <input id="staff-instagram" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className="form-input" />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button onClick={() => router.push('/admin/staff')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
