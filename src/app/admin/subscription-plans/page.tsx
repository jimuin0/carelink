'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbPageHeader } from '@/components/admin/SbUi';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  sessions_per_month: number;
  valid_months: number;
  is_active: boolean;
  notes: string | null;
}

interface Subscription {
  id: string;
  status: string;
  sessions_used_this_month: number;
  month_reset_at: string;
  ends_at: string | null;
  created_at: string;
  subscription_plans: { name: string; price: number; sessions_per_month: number } | null;
  profiles: { display_name: string; email: string } | null;
}

const EMPTY_PLAN = { name: '', description: '', price: 0, sessions_per_month: 4, valid_months: 1, notes: '' };
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active:    { label: '有効',     cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'キャンセル', cls: 'bg-red-100 text-red-700' },
  paused:    { label: '一時停止', cls: 'bg-yellow-100 text-yellow-700' },
  expired:   { label: '期限切れ', cls: 'bg-gray-100 text-gray-500' },
};

export default function SubscriptionPlansPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [tab, setTab] = useState<'plans' | 'subscribers'>('plans');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_PLAN);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: mem, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id)
      .in('role', ['owner', 'admin']).limit(1).single();
    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!mem?.facility_id) { setLoading(false); return; }
    setFacilityId(mem.facility_id);

    try {
      const [p, s] = await Promise.all([
        fetch(`/api/admin/subscription-plans?facility_id=${mem.facility_id}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch(`/api/admin/user-subscriptions?facility_id=${mem.facility_id}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      ]);
      setPlans(p.plans ?? []);
      setSubs((s.subscriptions ?? []) as Subscription[]);
    } catch {
      setLoadError(true); setLoading(false); return;
    }
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleCreate = async () => {
    if (!facilityId || saving) return;
    setSaving(true);
    const res = await fetch(`/api/admin/subscription-plans?facility_id=${facilityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, price: Number(form.price), sessions_per_month: Number(form.sessions_per_month), valid_months: Number(form.valid_months) }),
    });
    if (res.ok) {
      setToast({ type: 'success', message: '作成しました' });
      setShowForm(false);
      setForm(EMPTY_PLAN);
      load();
    } else {
      const e = await res.json();
      setToast({ type: 'error', message: e.error ?? '作成に失敗しました' });
    }
    setSaving(false);
  };

  const toggleActive = async (plan: Plan) => {
    const res = await fetch(`/api/admin/subscription-plans/${plan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !plan.is_active }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      setToast({ type: 'error', message: e?.error ?? '更新に失敗しました' });
    }
    load();
  };

  const handleDelete = (plan: Plan) => {
    setConfirmDeletePlan(plan);
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    if (!confirmDeletePlan) return;
    setConfirmDelete(false);
    const plan = confirmDeletePlan;
    setConfirmDeletePlan(null);
    const res = await fetch(`/api/admin/subscription-plans/${plan.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => null);
    if (res.ok) {
      setToast({ type: 'success', message: j?.message ?? '削除しました' });
    } else {
      setToast({ type: 'error', message: j?.error ?? '削除に失敗しました' });
    }
    load();
  };

  // 連打による多重リクエストを弾く同期ガード（ステート反映前の二重クリック対策）。
  const updatingStatusRef = useRef(false);
  const updateSubStatus = async (sub: Subscription, status: string) => {
    if (updatingStatusRef.current) return;
    updatingStatusRef.current = true;
    try {
      const res = await fetch('/api/admin/user-subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id: sub.id, status }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setToast({ type: 'error', message: e?.error ?? '更新に失敗しました' });
      }
      await load();
    } finally {
      updatingStatusRef.current = false;
    }
  };

  if (loading) return <AdminPageLoading />;

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <SbPageHeader
        title="月額プラン"
        description="サブスクリプション定義と契約者管理"
        actions={tab === 'plans' && (
          <button type="button" onClick={() => setShowForm(true)}
            className="btn-primary text-sm !px-4 !py-1.5">
            + 新規プラン
          </button>
        )}
      />

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['plans', 'subscribers'] as const).map((t) => (
          <button type="button" key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>
            {t === 'plans' ? 'プラン定義' : '契約者一覧'}
          </button>
        ))}
      </div>

      {loadError ? (
        <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="月額プランの読み込みに失敗しました" />
      ) : (
      <>
      {tab === 'plans' && (
        <>
          {showForm && (
            <div className="bg-white rounded-xl border border-sky-100 p-5 space-y-4">
              <h2 className="font-bold text-sm">新規プランを作成</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sp-name" className="text-xs text-gray-500 block mb-1">プラン名 <span className="text-red-500">*</span></label>
                  <input id="sp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    maxLength={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="月4回プラン など" />
                </div>
                <div>
                  <label htmlFor="sp-price" className="text-xs text-gray-500 block mb-1">月額料金（円）</label>
                  <input id="sp-price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min={0} />
                </div>
                <div>
                  <label htmlFor="sp-sessions" className="text-xs text-gray-500 block mb-1">月あたり回数</label>
                  <input id="sp-sessions" type="number" value={form.sessions_per_month} onChange={(e) => setForm({ ...form, sessions_per_month: Number(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min={1} max={100} />
                </div>
                <div>
                  <label htmlFor="sp-valid-months" className="text-xs text-gray-500 block mb-1">最低契約月数</label>
                  <input id="sp-valid-months" type="number" value={form.valid_months} onChange={(e) => setForm({ ...form, valid_months: Number(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" min={1} max={24} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="sp-description" className="text-xs text-gray-500 block mb-1">説明文</label>
                  <textarea id="sp-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={2} maxLength={500} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="月4回まで鍼灸施術を受けられるお得なプラン" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg">キャンセル</button>
                <button type="button" onClick={handleCreate} disabled={saving || !form.name}
                  className="btn-primary !px-6 !py-2 text-sm">
                  {saving ? '保存中...' : '作成'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {plans.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">プランが登録されていません</div>
            ) : plans.map((plan) => (
              <div key={plan.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{plan.name}</span>
                      <SbBadge tone={plan.is_active ? 'success' : 'neutral'}>
                        {plan.is_active ? '公開中' : '非公開'}
                      </SbBadge>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      月額 ¥{plan.price.toLocaleString()} / 月{plan.sessions_per_month}回 / 最低{plan.valid_months}ヶ月
                    </p>
                    {plan.description && <p className="text-xs text-gray-400 mt-0.5">{plan.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => toggleActive(plan)}
                      className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">
                      {plan.is_active ? '非公開に' : '公開に'}
                    </button>
                    <button type="button" onClick={() => handleDelete(plan)}
                      className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'subscribers' && (
        <div className="space-y-3">
          {subs.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">契約者がいません</div>
          ) : subs.map((sub) => {
            const st = STATUS_LABEL[sub.status] ?? { label: sub.status, cls: 'bg-gray-100 text-gray-500' };
            const plan = sub.subscription_plans;
            return (
              <div key={sub.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{sub.profiles?.display_name ?? '不明'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-xs text-gray-500">{plan?.name} — 月{plan?.sessions_per_month}回</p>
                    <p className="text-xs text-gray-400">
                      今月 {sub.sessions_used_this_month}/{plan?.sessions_per_month ?? '?'}回使用
                      {sub.ends_at && ` | 期限: ${new Date(sub.ends_at).toLocaleDateString('ja-JP')}`}
                    </p>
                  </div>
                  {sub.status === 'active' && (
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => updateSubStatus(sub, 'paused')}
                        className="text-xs text-yellow-600 border border-yellow-200 rounded px-2 py-1 hover:bg-yellow-50">
                        一時停止
                      </button>
                      <button type="button" onClick={() => updateSubStatus(sub, 'cancelled')}
                        className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
                        解約
                      </button>
                    </div>
                  )}
                  {sub.status === 'paused' && (
                    <button type="button" onClick={() => updateSubStatus(sub, 'active')}
                      className="text-xs text-green-600 border border-green-200 rounded px-2 py-1 hover:bg-green-50 shrink-0">
                      再開
                    </button>
                  )}
                  {sub.status === 'cancelled' && (
                    <button type="button" onClick={() => updateSubStatus(sub, 'active')}
                      className="text-xs text-green-600 border border-green-200 rounded px-2 py-1 hover:bg-green-50 shrink-0">
                      復活
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="プランを削除"
        message={`「${confirmDeletePlan?.name}」を削除しますか？`}
        confirmLabel="削除する"
        onConfirm={doDelete}
        onCancel={() => { setConfirmDelete(false); setConfirmDeletePlan(null); }}
      />
    </div>
  );
}
