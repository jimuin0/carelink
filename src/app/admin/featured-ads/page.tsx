'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbPageHeader } from '@/components/admin/SbUi';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

type FeaturedSlot = {
  id: string;
  slot_type: string;
  area: string | null;
  business_type: string | null;
  starts_at: string;
  ends_at: string;
  budget_yen: number;
  impressions: number;
  clicks: number;
  is_active: boolean;
};

const SLOT_LABELS: Record<string, string> = {
  search_top: '検索結果上位',
  area_banner: 'エリアバナー',
  category_top: 'カテゴリートップ',
};

const PLANS = [
  { type: 'search_top', label: '検索結果上位表示', price: 9800, desc: '指定エリア・業種の検索結果最上位に表示' },
  { type: 'area_banner', label: 'エリアページバナー', price: 4900, desc: 'エリア一覧ページの上部バナー枠' },
  { type: 'category_top', label: 'カテゴリートップ', price: 7800, desc: '業種別一覧の最上位固定表示' },
];

export default function FeaturedAdsPage() {
  const [slots, setSlots] = useState<FeaturedSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('search_top');
  const [form, setForm] = useState({ area: '', business_type: '', starts_at: '', ends_at: '' });
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const paymentStatus = searchParams.get('payment');

  const loadSlots = useCallback((fId: string) => {
    setLoadError(false);
    // GET /api/admin/featured-ads は facility_id 必須。従来このページは facility_id を取得・付与して
    // いなかったため常に 400→LoadError になり広告機能が丸ごと使用不能だった。
    fetch(`/api/admin/featured-ads?facility_id=${fId}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setSlots(d.slots || []); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  const reload = useCallback(async () => {
    setLoadError(false);
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadError(true); setLoading(false); return; }
    const { data: membership, error: memErr } = await supabase
      .from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
    if (memErr || !membership?.facility_id) { setLoadError(true); setLoading(false); return; }
    setFacilityId(membership.facility_id as string);
    loadSlots(membership.facility_id as string);
  }, [loadSlots]);

  useEffect(() => { reload(); }, [reload]);

  const ctr = (slot: FeaturedSlot) =>
    slot.impressions > 0 ? ((slot.clicks / slot.impressions) * 100).toFixed(1) : '0.0';

  const selectedPlanData = PLANS.find((p) => p.type === selectedPlan);

  return (
    <div className="max-w-4xl space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {paymentStatus === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800 font-medium">
          決済が完了しました。広告枠が有効化されました。
        </div>
      )}
      {paymentStatus === 'cancel' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          決済がキャンセルされました。再度お試しください。
        </div>
      )}
      <SbPageHeader title="広告・上位表示" description="検索結果の上位表示・バナー広告枠を管理します" actions={<button type="button" onClick={() => setShowCreate(true)} className="btn-primary !px-4 !py-2 text-sm">広告枠を購入</button>} />

      {/* Plans */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <div key={plan.type} className="bg-white rounded-xl border p-5">
            <div className="font-semibold text-gray-900">{plan.label}</div>
            <div className="text-2xl font-bold text-primary mt-2">¥{plan.price.toLocaleString()}<span className="text-sm font-normal text-gray-500">/月</span></div>
            <p className="text-xs text-gray-500 mt-2">{plan.desc}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">広告枠を申し込む</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PLANS.map((plan) => (
              <button
                key={plan.type}
                type="button"
                onClick={() => setSelectedPlan(plan.type)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  selectedPlan === plan.type ? 'border-primary bg-sky-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-medium">{plan.label}</div>
                <div className="text-sm text-primary font-bold mt-0.5">¥{plan.price.toLocaleString()}/月</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">対象エリア（任意）</label>
              <input
                type="text"
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                placeholder="例: 豊中市"
                maxLength={50}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">対象業種（任意）</label>
              <input
                type="text"
                value={form.business_type}
                onChange={(e) => setForm((f) => ({ ...f, business_type: e.target.value }))}
                placeholder="例: 鍼灸院"
                maxLength={50}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">掲載開始日</label>
              <input
                type="date"
                value={form.starts_at}
                onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">掲載終了日</label>
              <input
                type="date"
                value={form.ends_at}
                onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          {selectedPlanData && (
            <div className="bg-sky-50 rounded-lg p-4 text-sm">
              <div className="font-medium text-gray-900">{selectedPlanData.label}</div>
              <div className="text-primary font-bold mt-1">¥{selectedPlanData.price.toLocaleString()}/月（税込¥{Math.round(selectedPlanData.price * 1.1).toLocaleString()}）</div>
              <p className="text-gray-600 text-xs mt-1">{selectedPlanData.desc}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={submitting || !form.starts_at || !form.ends_at}
              onClick={async () => {
                if (submitting) return;
                if (!facilityId) { setToast({ type: 'error', message: '施設情報の取得に失敗しました。再読み込みしてください' }); return; }
                setSubmitting(true);
                try {
                  // POST も facility_id 必須。従来 body に含めず常に 400 になっていた。
                  const res = await fetch('/api/admin/featured-ads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ facility_id: facilityId, slot_type: selectedPlan, ...form }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setToast({ type: 'error', message: data.error || '申込みに失敗しました' });
                  } else if (data.checkout_url && /^https:\/\/checkout\.stripe\.com\//.test(data.checkout_url)) {
                    window.location.href = data.checkout_url;
                  } else {
                    setSlots((prev) => [data.slot, ...prev]);
                    setShowCreate(false);
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
              className="btn-primary !px-4 !py-2 text-sm"
            >
              {submitting ? '処理中...' : '決済へ進む'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Active slots */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">掲載中・予定の広告枠</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">読み込み中...</div>
        ) : loadError ? (
          <div className="p-6"><LoadError onRetry={() => { setLoading(true); reload(); }} message="広告枠の読み込みに失敗しました" /></div>
        ) : slots.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <p>まだ広告枠がありません</p>
            <p className="text-xs mt-2">上位表示で予約を増やしましょう</p>
          </div>
        ) : (
          <div className="divide-y">
            {slots.map((slot) => (
              <div key={slot.id} className="px-6 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{SLOT_LABELS[slot.slot_type] || slot.slot_type}</span>
                      <SbBadge tone={slot.is_active ? 'success' : 'neutral'}>
                        {slot.is_active ? '掲載中' : '停止中'}
                      </SbBadge>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 space-x-2">
                      {slot.area && <span>エリア: {slot.area}</span>}
                      {slot.business_type && <span>業種: {slot.business_type}</span>}
                      <span>{new Date(slot.starts_at).toLocaleDateString('ja-JP')} 〜 {new Date(slot.ends_at).toLocaleDateString('ja-JP')}</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-600 space-y-0.5">
                    <div>表示: <strong>{slot.impressions.toLocaleString()}</strong></div>
                    <div>クリック: <strong>{slot.clicks.toLocaleString()}</strong></div>
                    <div>CTR: <strong>{ctr(slot)}%</strong></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
