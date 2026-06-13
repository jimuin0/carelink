'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface TreatmentRecord {
  id: string;
  treated_at: string;
  menu_name: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  notes: string | null;
  next_visit_note: string | null;
  profiles: { display_name: string; email: string } | null;
  staff_profiles: { name: string } | null;
}

const EMPTY_FORM = {
  user_search: '',
  user_id: '',
  menu_name: '',
  treated_at: new Date().toISOString().slice(0, 16),
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  notes: '',
  next_visit_note: '',
};

export default function TreatmentRecordsPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [records, setRecords] = useState<TreatmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState<TreatmentRecord | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [customers, setCustomers] = useState<{ id: string; display_name: string; email: string }[]>([]);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: mem, error: memErr } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1).single();

    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!mem?.facility_id) { setLoading(false); return; }
    setFacilityId(mem.facility_id);

    const { data: recs, error: recsErr } = await supabase
      .from('treatment_records')
      .select('id, treated_at, menu_name, subjective, objective, assessment, plan, notes, next_visit_note, profiles(display_name, email), staff_profiles(name)')
      .eq('facility_id', mem.facility_id)
      .order('treated_at', { ascending: false })
      .limit(200);

    if (recsErr) { setLoadError(true); setLoading(false); return; }
    setRecords((recs ?? []) as unknown as TreatmentRecord[]);

    // 顧客一覧（オートコンプリート用・補助）。取得失敗時は候補空のままにし記録一覧本体は表示継続。
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
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    setCustomers(list);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleSave = async () => {
    if (!facilityId || saving) return;
    setSaving(true);

    const payload = {
      user_id: form.user_id || null,
      treated_at: form.treated_at,
      menu_name: form.menu_name || null,
      subjective: form.subjective || null,
      objective: form.objective || null,
      assessment: form.assessment || null,
      plan: form.plan || null,
      notes: form.notes || null,
      next_visit_note: form.next_visit_note || null,
    };

    let res: Response;
    if (editRecord) {
      res = await fetch(`/api/admin/treatment-records/${editRecord.id}?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(`/api/admin/treatment-records?facility_id=${facilityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '保存に失敗しました' });
    } else {
      setToast({ type: 'success', message: editRecord ? '更新しました' : '記録しました' });
      setShowForm(false);
      setEditRecord(null);
      setForm(EMPTY_FORM);
      load();
    }
    setSaving(false);
  };

  const handleEdit = (r: TreatmentRecord) => {
    setEditRecord(r);
    setForm({
      user_search: r.profiles?.display_name ?? '',
      user_id: '',
      menu_name: r.menu_name ?? '',
      treated_at: r.treated_at.slice(0, 16),
      subjective: r.subjective ?? '',
      objective: r.objective ?? '',
      assessment: r.assessment ?? '',
      plan: r.plan ?? '',
      notes: r.notes ?? '',
      next_visit_note: r.next_visit_note ?? '',
    });
    setShowForm(true);
  };

  const filtered = records.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.profiles?.display_name?.toLowerCase().includes(q) ||
      r.menu_name?.toLowerCase().includes(q) ||
      r.subjective?.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">施術記録</h1>
          <p className="text-xs text-gray-400 mt-0.5">患者の施術経過・SOAP記録を管理</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditRecord(null); setForm(EMPTY_FORM); setShowForm(true); }}
          className="text-sm px-4 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium"
        >
          + 新規記録
        </button>
      </div>

      {/* 検索 */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="患者名・メニュー・内容で検索..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
      />

      {/* フォーム */}
      {showForm && (
        <div className="bg-white rounded-xl border border-sky-100 p-5 space-y-4">
          <h2 className="font-bold text-sm">{editRecord ? '施術記録を編集' : '施術記録を追加'}</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">患者（予約顧客から選択）</label>
              <input
                value={form.user_search}
                onChange={(e) => {
                  setForm({ ...form, user_search: e.target.value, user_id: '' });
                }}
                list="customers-list"
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  const match = customers.find((c) => c.display_name === val || c.email === val);
                  if (match) setForm((prev) => ({ ...prev, user_id: match.id }));
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="名前またはメールで検索"
              />
              <datalist id="customers-list">
                {customers.map((c) => (
                  <option key={c.id} value={c.display_name}>{c.email}</option>
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術日時 <span className="text-red-500">*</span></label>
              <input
                type="datetime-local"
                value={form.treated_at}
                onChange={(e) => setForm({ ...form, treated_at: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">施術メニュー</label>
            <input
              value={form.menu_name}
              onChange={(e) => setForm({ ...form, menu_name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="鍼灸治療 / 整体 など"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">S: 主訴（患者の訴え）</label>
              <textarea value={form.subjective} onChange={(e) => setForm({ ...form, subjective: e.target.value })}
                rows={3} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="腰が痛い、右肩こり..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">O: 所見（他覚的）</label>
              <textarea value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}
                rows={3} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="L4/5圧痛+、ROM制限..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">A: 評価</label>
              <textarea value={form.assessment} onChange={(e) => setForm({ ...form, assessment: e.target.value })}
                rows={3} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="腰椎捻挫、筋緊張亢進..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">P: 計画</label>
              <textarea value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                rows={3} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="鍼治療週2回、3週間..." />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">次回への申し送り</label>
            <textarea value={form.next_visit_note} onChange={(e) => setForm({ ...form, next_visit_note: e.target.value })}
              rows={2} maxLength={2000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="次回は腰部中心で..." />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => { setShowForm(false); setEditRecord(null); }}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">
              キャンセル
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !form.treated_at}
              className="px-6 py-2 text-sm bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50 font-medium">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 記録一覧 */}
      <div className="space-y-3">
        {loadError ? (
          <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="施術記録の読み込みに失敗しました" />
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
            {search ? '検索結果がありません' : '施術記録がありません'}
          </div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-gray-400">{new Date(r.treated_at).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {r.profiles && <span className="font-medium text-sm text-gray-800">{r.profiles.display_name}</span>}
                  {r.menu_name && <span className="text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">{r.menu_name}</span>}
                  {r.staff_profiles && <span className="text-xs text-gray-400">担当: {r.staff_profiles.name}</span>}
                </div>
                <button type="button" onClick={() => handleEdit(r)} className="text-xs text-sky-600 hover:underline shrink-0">編集</button>
              </div>

              {/* SOAP */}
              {(r.subjective || r.objective || r.assessment || r.plan) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {[
                    { label: 'S', value: r.subjective },
                    { label: 'O', value: r.objective },
                    { label: 'A', value: r.assessment },
                    { label: 'P', value: r.plan },
                  ].map(({ label, value }) => value && (
                    <div key={label} className="bg-gray-50 rounded-lg p-2">
                      <span className="text-xs font-bold text-gray-500">{label}</span>
                      <p className="text-xs text-gray-700 mt-0.5 line-clamp-3">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {r.next_visit_note && (
                <div className="bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <span className="font-bold">次回申し送り: </span>{r.next_visit_note}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
