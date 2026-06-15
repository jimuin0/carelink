'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

/** javascript:/data:/vbscript: などの危険なスキームを弾く */
function safeMeetingUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

interface Session {
  id: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  meeting_url: string | null;
  platform: string;
  patient_notes: string | null;
  session_notes: string | null;
  fee: number;
  profiles: { display_name: string; email: string } | null;
  staff_profiles: { name: string } | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  scheduled:   { label: '予定',      cls: 'bg-sky-100 text-sky-700' },
  in_progress: { label: '進行中',    cls: 'bg-green-100 text-green-700' },
  completed:   { label: '完了',      cls: 'bg-gray-100 text-gray-500' },
  cancelled:   { label: 'キャンセル', cls: 'bg-red-100 text-red-700' },
  no_show:     { label: '無断欠席',  cls: 'bg-orange-100 text-orange-700' },
};

const EMPTY_FORM = {
  user_search: '', user_id: '',
  scheduled_at: new Date().toISOString().slice(0, 16),
  duration_minutes: 30,
  meeting_url: '',
  platform: 'external',
  patient_notes: '',
  fee: 0,
};

export default function TelehealthPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [customers, setCustomers] = useState<{ id: string; display_name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<'upcoming' | 'all'>('upcoming');

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: mem, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!mem?.facility_id) { setLoading(false); return; }
    setFacilityId(mem.facility_id);

    const { data: s, error: sErr } = await supabase
      .from('telehealth_sessions')
      .select('id, status, scheduled_at, duration_minutes, meeting_url, platform, patient_notes, session_notes, fee, profiles(display_name, email), staff_profiles(name)')
      .eq('facility_id', mem.facility_id)
      .order('scheduled_at', { ascending: false })
      .limit(100);
    if (sErr) { setLoadError(true); setLoading(false); return; }
    setSessions((s ?? []) as unknown as Session[]);

    // 新規作成フォームの患者候補（補助）。取得失敗時は候補空のままにし一覧本体は表示継続。
    // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
    const { data: bookings } = await supabase
      .from('bookings')
      .select('user_id, profiles(id, display_name, email)')
      .eq('facility_id', mem.facility_id)
      .not('user_id', 'is', null)
      .limit(500);
    const seen = new Set<string>();
    const list: { id: string; display_name: string; email: string }[] = [];
    for (const b of bookings ?? []) {
      const p = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { id: string; display_name: string; email: string } | null;
      if (p && !seen.has(p.id)) { seen.add(p.id); list.push(p); }
    }
    setCustomers(list);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleCreate = async () => {
    if (!facilityId || saving) return;
    setSaving(true);
    const res = await fetch(`/api/admin/telehealth?facility_id=${facilityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: form.user_id || null,
        scheduled_at: form.scheduled_at,
        duration_minutes: form.duration_minutes,
        meeting_url: form.meeting_url || null,
        platform: form.platform,
        patient_notes: form.patient_notes || null,
        fee: form.fee,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '作成に失敗しました' });
    } else {
      setToast({ type: 'success', message: 'オンライン相談を作成しました' });
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/admin/telehealth/${id}?facility_id=${facilityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      load();
    } else {
      setToast({ type: 'error', message: 'ステータスの更新に失敗しました' });
    }
  };

  const filtered = sessions.filter((s) => {
    if (filter === 'upcoming') return s.status === 'scheduled' || s.status === 'in_progress';
    return true;
  });

  if (loading) return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">テレヘルス・オンライン相談</h1>
          <p className="text-xs text-gray-400 mt-0.5">ビデオ通話による遠隔相談・診療の管理</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)}
          className="text-sm px-4 py-1.5 bg-sky-600 text-white rounded-lg hover:bg-sky-700 font-medium">
          + 相談を作成
        </button>
      </div>

      {/* フォーム */}
      {showForm && (
        <div className="bg-white rounded-xl border border-sky-100 p-5 space-y-4">
          <h2 className="font-bold text-sm">オンライン相談を作成</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">患者</label>
              <input value={form.user_search}
                onChange={(e) => setForm({ ...form, user_search: e.target.value, user_id: '' })}
                list="customers-tele"
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  const match = customers.find((c) => c.display_name === val || c.email === val);
                  if (match) setForm((prev) => ({ ...prev, user_id: match.id }));
                }}
                maxLength={100}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="名前またはメール" />
              <datalist id="customers-tele">
                {customers.map((c) => <option key={c.id} value={c.display_name}>{c.email}</option>)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">予約日時 <span className="text-red-500">*</span></label>
              <input type="datetime-local" value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">時間（分）</label>
              <select value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}分</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">料金（円）</label>
              <input type="number" value={form.fee} onChange={(e) => setForm({ ...form, fee: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min={0} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">会議URL（Zoom / Google Meet）</label>
              <input value={form.meeting_url} onChange={(e) => setForm({ ...form, meeting_url: e.target.value })}
                maxLength={500} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="https://zoom.us/j/..." />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">事前問診内容</label>
              <textarea value={form.patient_notes} onChange={(e) => setForm({ ...form, patient_notes: e.target.value })}
                rows={2} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="相談したい内容・症状..." />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={saving || !form.scheduled_at}
              className="px-6 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 font-medium">
              {saving ? '保存中...' : '作成'}
            </button>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['upcoming', 'all'] as const).map((t) => (
          <button type="button" key={t} onClick={() => setFilter(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === t ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>
            {t === 'upcoming' ? '予定・進行中' : '全件'}
          </button>
        ))}
      </div>

      {/* 一覧 */}
      <div className="space-y-3">
        {loadError ? (
          <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="オンライン相談の読み込みに失敗しました" />
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">オンライン相談がありません</div>
        ) : filtered.map((s) => {
          const st = STATUS_LABEL[s.status] ?? { label: s.status, cls: 'bg-gray-100 text-gray-500' };
          return (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-400">
                      {new Date(s.scheduled_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    <span className="text-xs text-gray-500">{s.duration_minutes}分</span>
                    {s.fee > 0 && <span className="text-xs text-gray-500">¥{s.fee.toLocaleString()}</span>}
                  </div>
                  {s.profiles && <p className="text-sm font-medium text-gray-800">{s.profiles.display_name}</p>}
                  {s.patient_notes && <p className="text-xs text-gray-500 line-clamp-2">{s.patient_notes}</p>}
                  {safeMeetingUrl(s.meeting_url) && (
                    <a href={safeMeetingUrl(s.meeting_url)!} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      会議に参加
                    </a>
                  )}
                </div>
                {s.status === 'scheduled' && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => updateStatus(s.id, 'in_progress')}
                      className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">開始</button>
                    <button type="button" onClick={() => updateStatus(s.id, 'cancelled')}
                      className="text-xs text-red-500 border border-red-200 px-3 py-1 rounded hover:bg-red-50">キャンセル</button>
                  </div>
                )}
                {s.status === 'in_progress' && (
                  <button type="button" onClick={() => updateStatus(s.id, 'completed')}
                    className="text-xs bg-sky-600 text-white px-3 py-1 rounded hover:bg-sky-700 shrink-0">完了</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
