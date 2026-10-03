'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';

export default function NewStaffPage() {
  const requestedFacility = useSearchParams().get('facility_id');
  return <NewStaffPageForm key={requestedFacility ?? ''} />;
}

function NewStaffPageForm() {
  const router = useRouter();
  const mounted = useRef(true);
  const requestedFacility = useSearchParams().get('facility_id');
  const [facilityChoices, setFacilityChoices] = useState<AdminFacilityChoice[]>([]);
  const [authState, setAuthState] = useState<'verified' | 'unauthenticated' | 'unavailable'>('verified');
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const backFacility = facilityId ?? requestedFacility;
  const backHref = `/admin/staff${backFacility ? `?facility_id=${encodeURIComponent(backFacility)}` : ''}`;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [nominationFee, setNominationFee] = useState('');
  const [lineWorksChannelId, setLineWorksChannelId] = useState('');
  const [lineWorksNotifyAll, setLineWorksNotifyAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    (async () => {
      setLoading(true);
      setFacilityId(null);
      setLoadError(false);
      const db = createBrowserSupabaseClient();
      const verification = await verifyAuthUser(db.auth);
      if (!active) return;
      setAuthState(verification.state);
      if (verification.state !== 'verified') { setLoading(false); return; }
      const selection = await loadAdminFacilitySelection(db, verification.user.id, requestedFacility);
      if (!active) return;
      setFacilityChoices(selection.choices);
      setFacilityId(selection.selectedId);
      setLoading(false);
    })().catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; mounted.current = false; };
  }, [requestedFacility]);

  const handleCreate = async () => {
    if (saving || loading || !facilityId || !name.trim()) {
      setToast({ type: 'error', message: '名前は必須です' });
      return;
    }
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/staff?facility_id=${facilityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          position: position.trim() || null,
          bio: bio.trim() || null,
          specialties: specialties ? specialties.split(',').map((s: string) => s.trim()) : [],
          years_experience: yearsExperience ? parseInt(yearsExperience) : null,
          instagram_url: instagramUrl.trim() || null,
          nomination_fee: nominationFee ? parseInt(nominationFee) : 0,
          line_works_channel_id: lineWorksChannelId.trim() || null,
          line_works_notify_all: lineWorksNotifyAll,
        }),
      });

      if (!mounted.current) return;
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '追加に失敗しました' });
      } else {
        router.push(backHref);
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p role="status">読み込み中...</p>;
  if (authState === 'unavailable') return <AccessVerificationUnavailable />;
  if (authState === 'unauthenticated') return <p role="alert">セッションが切れました。再ログインしてください。</p>;
  if (loadError) return <p role="alert">店舗情報の取得に失敗しました。再読み込みしてください。</p>;
  const selector = <FacilitySelector choices={facilityChoices} selectedId={facilityId} path="/admin/staff/new" dirty={Boolean(name || position || bio || specialties || yearsExperience || instagramUrl || nominationFee || lineWorksChannelId || lineWorksNotifyAll)} busy={saving} />;
  if (!facilityId) return selector;

  return (
    <div>
      {selector}
      <SbPageHeader title="スタッフ追加" />

      <div className="bg-white rounded-xl shadow-xs p-6 space-y-4">
        <div>
          <label htmlFor="staff-name" className="form-label">名前 <span className="text-red-500">*</span></label>
          <SbInput id="staff-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </div>
        <div>
          <label htmlFor="staff-position" className="form-label">役職</label>
          <SbInput id="staff-position" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="店長、スタイリスト等" maxLength={50} />
        </div>
        <div>
          <label htmlFor="staff-bio" className="form-label">自己紹介</label>
          <textarea id="staff-bio" value={bio} onChange={(e) => setBio(e.target.value)} className="form-input" rows={4} maxLength={500} />
        </div>
        <div>
          <label htmlFor="staff-specialties" className="form-label">得意分野（カンマ区切り）</label>
          <SbInput id="staff-specialties" value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="カット, カラー, パーマ" maxLength={200} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="staff-years" className="form-label">経験年数</label>
            <SbInput id="staff-years" type="number" value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} />
          </div>
          <div>
            <label htmlFor="staff-fee" className="form-label">指名料（円）</label>
            <SbInput id="staff-fee" type="number" value={nominationFee} onChange={(e) => setNominationFee(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div>
          <label htmlFor="staff-instagram" className="form-label">Instagram URL</label>
          <SbInput id="staff-instagram" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} maxLength={200} />
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">LINE Works 通知設定</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="staff-lw-channel" className="form-label">LINE Works チャンネルID</label>
              <SbInput
                id="staff-lw-channel"
                value={lineWorksChannelId}
                onChange={(e) => setLineWorksChannelId(e.target.value)}
                placeholder="例: 12345678901234567"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={lineWorksNotifyAll}
                onChange={(e) => setLineWorksNotifyAll(e.target.checked)}
                className="rounded-sm border-gray-300"
              />
              <span className="text-sm text-gray-700">担当外の予約（全件）も通知を受け取る</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push(backHref)} className="text-sm text-gray-500 hover:underline">戻る</button>
          <button type="button" onClick={handleCreate} disabled={saving} className="btn-primary flex-1 py-3!">
            {saving ? '追加中...' : 'スタッフを追加'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
