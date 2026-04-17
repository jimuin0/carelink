'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface PaymentSession {
  id: string;
  stripe_session_id: string;
  amount: number;
  status: string;
  payment_type: string;
  created_at: string;
  bookings?: { customer_name: string | null; booking_date: string | null } | null;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  refunded: 'bg-blue-100 text-blue-800',
  expired: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  pending: '決済待ち',
  paid: '支払済み',
  cancelled: 'キャンセル',
  refunded: '返金済み',
  expired: '期限切れ',
};

export default function AdminPaymentsPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PaymentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositType, setDepositType] = useState<'none' | 'fixed' | 'percent'>('none');
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return; }
      const { data: mem } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!mem) { setLoading(false); return; }
      setFacilityId(mem.facility_id);

      const [{ data: facility }, { data: payData }] = await Promise.all([
        supabase.from('facility_profiles').select('stripe_enabled, deposit_amount, deposit_type').eq('id', mem.facility_id).single(),
        supabase.from('stripe_sessions').select('id, stripe_session_id, amount, status, payment_type, created_at').eq('facility_id', mem.facility_id).order('created_at', { ascending: false }).limit(50),
      ]);

      if (facility) {
        setStripeEnabled(facility.stripe_enabled ?? false);
        setDepositAmount(facility.deposit_amount ?? 0);
        setDepositType(facility.deposit_type ?? 'none');
      }
      setSessions((payData ?? []) as PaymentSession[]);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!facilityId) return;
    setSaving(true);
    const supabase = createBrowserSupabaseClient();
    await supabase.from('facility_profiles').update({
      deposit_amount: depositAmount,
      deposit_type: depositType,
    }).eq('id', facilityId);
    setSaving(false);
    alert('保存しました');
  };

  const totalPaid = sessions.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0);
  const totalRefunded = sessions.filter((s) => s.status === 'refunded').reduce((sum, s) => sum + s.amount, 0);

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-40 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold">決済管理</h1>
        <p className="text-xs text-gray-400 mt-0.5">Stripe連携・デポジット設定・入金状況確認</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400">入金合計</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">¥{totalPaid.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400">返金合計</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">¥{totalRefunded.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400">決済件数</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{sessions.length}件</p>
        </div>
      </div>

      {/* Stripe status */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800">Stripe連携</h2>
          <span className={`text-xs px-2 py-1 rounded-full font-bold ${stripeEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {stripeEnabled ? '有効' : '未設定'}
          </span>
        </div>

        {!stripeEnabled && (
          <div className="bg-amber-50 rounded-lg p-4 text-sm text-amber-800">
            <p className="font-bold mb-1">Stripe連携を有効にするには</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Stripeアカウントを作成（<a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer" className="underline">stripe.com</a>）</li>
              <li>本番用シークレットキーを取得</li>
              <li>CareLinK運営（support@carelink-jp.com）にStripe Account IDをお知らせください</li>
            </ol>
          </div>
        )}

        {stripeEnabled && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">デポジット設定</label>
              <div className="space-y-2">
                {(['none', 'fixed', 'percent'] as const).map((type) => (
                  <label key={type} className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" value={type} checked={depositType === type} onChange={() => setDepositType(type)} />
                    <span className="text-sm">
                      {type === 'none' && 'デポジットなし（無料予約）'}
                      {type === 'fixed' && '固定金額'}
                      {type === 'percent' && 'メニュー金額の割合（%）'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {depositType !== 'none' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  {depositType === 'fixed' ? 'デポジット金額（円）' : 'デポジット率（%）'}
                </label>
                <input
                  type="number"
                  min={depositType === 'fixed' ? 100 : 1}
                  max={depositType === 'percent' ? 100 : undefined}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(parseInt(e.target.value) || 0)}
                  className="w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}

            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2.5 bg-sky-500 text-white rounded-lg font-bold text-sm hover:bg-sky-600 disabled:opacity-50 transition-colors">
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>
        )}
      </div>

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">決済履歴</h2>
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400 p-6 text-center">決済履歴はまだありません</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {sessions.map((s) => (
              <div key={s.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${statusColors[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {statusLabels[s.status] ?? s.status}
                    </span>
                    <span className="text-xs text-gray-400">{s.payment_type === 'deposit' ? 'デポジット' : '全額'}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 font-mono">{s.stripe_session_id.slice(0, 20)}...</p>
                  <p className="text-xs text-gray-400">{new Date(s.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <p className="font-bold text-gray-900 shrink-0">¥{s.amount.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
