'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function NewStaffPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [nominationFee, setNominationFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async () => {
    if (saving || !name.trim()) {
      setToast({ type: 'error', message: '名前は必須です' });
      return;
    }
    setSaving(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) return;

      const { error } = await supabase.from('staff_profiles').insert({
        facility_id: membership.facility_id,
        name: name.trim(),
        position: position.trim() || null,
        bio: bio.trim() || null,
        specialties: specialties ? specialties.split(',').map((s) => s.trim()) : [],
        years_experience: yearsExperience ? parseInt(yearsExperience) : null,
        instagram_url: instagramUrl.trim() || null,
        nomination_fee: nominationFee ? parseInt(nominationFee) : 0,
        is_active: true,
      });

      if (error) {
        setToast({ type: 'error', message: '追加に失敗しました' });
      } else {
        router.push('/admin/staff');
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">スタッフ追加</h1>

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
            <label htmlFor="staff-fee" className="form-label">指名料（円）</label>
            <input id="staff-fee" type="number" value={nominationFee} onChange={(e) => setNominationFee(e.target.value)} className="form-input" placeholder="0" />
          </div>
        </div>
        <div>
          <label htmlFor="staff-instagram" className="form-label">Instagram URL</label>
          <input id="staff-instagram" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className="form-input" />
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push('/admin/staff')} className="text-sm text-gray-500 hover:underline">戻る</button>
          <button type="button" onClick={handleCreate} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '追加中...' : 'スタッフを追加'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
