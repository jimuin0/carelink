'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

interface TreatmentPlan {
  id: string;
  title: string;
  diagnosis: string | null;
  goal: string | null;
  total_sessions: number;
  completed_sessions: number;
  frequency: string | null;
  duration_weeks: number | null;
  status: 'active' | 'completed' | 'discontinued' | 'paused';
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  profiles: { display_name: string; email: string } | null;
  staff_profiles: { name: string } | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '進行中', color: 'bg-emerald-100 text-emerald-700' },
  completed: { label: '完了', color: 'bg-sky-100 text-sky-700' },
  paused: { label: '一時停止', color: 'bg-amber-100 text-amber-700' },
  discontinued: { label: '中断', color: 'bg-gray-100 text-gray-500' },
};

const EMPTY_FORM = {
  user_search: '',
  user_id: '',
  title: '',
  diagnosis: '',
  goal: '',
  total_sessions: 10,
  frequency: '週2回',
  duration_weeks: 5,
  started_at: new Date().toISOString().slice(0, 10),
  notes: '',
};

export default function TreatmentPlansPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');
  const [customers, setCustomers] = useState<{ id: string; display_name: string; email: string }[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: mem } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1).single();
    if (!mem?.facility_id) return;
    setFacilityId(mem.facility_id);

    const { data } = await supabase
      .from('treatment_plans')
      .select('id, title, diagnosis, goal, total_sessions, completed_sessions, frequency, duration_weeks, status, started_at, ended_at, notes, profiles(display_name, email), staff_profiles(name)')
      .eq('facility_id', mem.facility_id)
      .order('created_at', { ascending: false })
      .limit(200);

    setPlans((data ?? []) as unknown as TreatmentPlan[]);

    const { data: bookings } = await supabase
      .from('bookings')
      .select('user_id, profiles(id, display_name, email)')
      .eq('facility_id', mem.facility_id)
      .not('user_id', 'is', null)
      .limit(500);

    const seen = new Set<string>();
    const list: typeof customers = [];
    for (const b of bookings ?? []) {
      const p = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { id: string; display_name: string; email: string } | null;
      if (p && !seen.has(p.id)) { seen.add(p.id); list.push(p); }
    }
    setCustomers(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!facilityId || saving || !form.title) return;
    setSaving(true);
    const res = await fetch(`/api/admin/treatment-plans?facility_id=${facilityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: form.user_id || null,
        title: form.title,
        diagnosis: form.diagnosis || null,
        goal: form.goal || null,
        total_sessions: Number(form.total_sessions),
        frequency: form.frequency || null,
        duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null,
        started_at: form.started_at || null,
        notes: form.notes || null,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '保存に失敗しました' });
    } else {
      setToast({ type: 'success', message: '治療計画を作成しました' });
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    }
    setSaving(false);
  };

  const handleUpdateStatus = async (planId: string, newStatus: string, addSession = false) => {
    if (!facilityId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const updates: Record<string, unknown> = { status: newStatus };
    if (addSession) {
      updates.completed_sessions = Math.min(plan.completed_sessions + 1, plan.total_sessions);
      if (updates.completed_sessions === plan.total_sessions) updates.status = 'completed';
    }
    const res = await fetch(`/api/admin/treatment-plans/${planId}?facility_id=${facilityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      setPlans((prev) => prev.map((p) => p.id === planId ? { ...p, ...updates as Partial<TreatmentPlan> } : p));
    } else {
      setToast({ type: 'error', message: '更新に失敗しました' });
    }
  };

  const filtered = statusFilter === 'active'
    ? plans.filter((p) => p.status === 'active')
    : plans;

  if (loading) {
    return <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">治療計画</h1>
          <p className="text-xs text-gray-400 mt-0.5">患者ごとの施術プラン・進捗管理</p>
        </div>
        <button type="button" onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}
          className="text-sm px-4 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium">
          + 新規計画
        </button>
      </div>

      <div className="flex gap-2">
        {(['active', 'all'] as const).map((s) => (
          <button type="button" key={s} onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${statusFilter === s ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
            {s === 'active' ? '進行中のみ' : `全て（${plans.length}）`}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-sky-100 p-5 space-y-4">
          <h2 className="font-bold text-sm">新規治療計画</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">患者</label>
              <input value={form.user_search} onChange={(e) => setForm({ ...form, user_search: e.target.value, user_id: '' })}
                list="plan-customers-list"
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  const match = customers.find((c) => c.display_name === val || c.email === val);
                  if (match) setForm((prev) => ({ ...prev, user_id: match.id }));
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="名前で検索" />
              <datalist id="plan-customers-list">
                {customers.map((c) => <option key={c.id} value={c.display_name}>{c.email}</option>)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">プランタイトル <span className="text-red-500">*</span></label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                maxLength={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="腰痛改善 3ヶ月プラン" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">診断・主訴</label>
              <input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
                maxLength={200} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="慢性腰痛、L4/5椎間板症" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">治療目標</label>
              <input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })}
                maxLength={200} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="VAS 7→2以下、ADL改善" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">計画回数</label>
              <input type="number" value={form.total_sessions} onChange={(e) => setForm({ ...form, total_sessions: parseInt(e.target.value) || 1 })}
                min={1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">通院頻度</label>
              <input value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                maxLength={50} list="freq-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <datalist id="freq-list">
                {['週1回', '週2回', '週3回', '月2回', '月1回'].map((f) => <option key={f} value={f} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">開始日</label>
              <input type="date" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">キャンセル</button>
            <button type="button" onClick={handleCreate} disabled={saving || !form.title}
              className="px-6 py-2 text-sm bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:opacity-50 font-medium">
              {saving ? '保存中...' : '作成'}
            </button>
          </div>
        </div>
      )}

      {/* 計画一覧 */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">
            {statusFilter === 'active' ? '進行中の治療計画がありません' : '治療計画がありません'}
          </div>
        ) : (
          filtered.map((plan) => {
            const pct = Math.round((plan.completed_sessions / plan.total_sessions) * 100);
            const st = STATUS_LABELS[plan.status];
            return (
              <div key={plan.id} className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{plan.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    </div>
                    {plan.profiles && <p className="text-xs text-sky-600 mt-0.5">{plan.profiles.display_name}</p>}
                    {plan.diagnosis && <p className="text-xs text-gray-500 mt-0.5">診断: {plan.diagnosis}</p>}
                    {plan.goal && <p className="text-xs text-gray-500">目標: {plan.goal}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold text-sky-600">{plan.completed_sessions}</p>
                    <p className="text-xs text-gray-400">/{plan.total_sessions}回</p>
                  </div>
                </div>

                {/* 進捗バー */}
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                    <span>{plan.frequency && `${plan.frequency}・`}{plan.started_at && `開始 ${plan.started_at}`}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>

                {plan.status === 'active' && (
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => handleUpdateStatus(plan.id, 'active', true)}
                      className="text-xs px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg hover:bg-sky-100 border border-sky-200 font-medium">
                      +1回 記録
                    </button>
                    <button type="button" onClick={() => handleUpdateStatus(plan.id, 'paused')}
                      className="text-xs px-3 py-1.5 text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                      一時停止
                    </button>
                    <button type="button" onClick={() => handleUpdateStatus(plan.id, 'completed')}
                      className="text-xs px-3 py-1.5 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50">
                      完了
                    </button>
                  </div>
                )}
                {plan.status === 'paused' && (
                  <button type="button" onClick={() => handleUpdateStatus(plan.id, 'active')}
                    className="text-xs px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg hover:bg-sky-100 border border-sky-200 font-medium">
                    再開
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
