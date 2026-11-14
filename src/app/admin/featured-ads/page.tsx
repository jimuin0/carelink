'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbBadge, SbPageHeader } from '@/components/admin/SbUi';
import FacilitySelector from '@/components/admin/FacilitySelector';
import AdminFacilityScope, { type AdminFacilityScopeValue } from '@/components/admin/AdminFacilityScope';
import { businessTypeLabel } from '@/lib/business-type-label';

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
  billing_status: string | null;
  current_period_end: string | null;
};

type Sales =
  | { enabled: false }
  | { enabled: true; publicKey: string; priceTaxExcluded: number; priceTaxIncluded: number };

/** payjp.js v2（https://js.pay.jp/v2/pay.js）のうち、ここで使う部分だけの型。 */
type PayjpCardElement = { mount: (selector: string) => void; unmount: () => void };
type PayjpClient = {
  elements: () => { create: (type: 'card') => PayjpCardElement };
  createToken: (element: PayjpCardElement) => Promise<{ id?: string; error?: { message?: string } }>;
};
declare global {
  interface Window { Payjp?: (publicKey: string) => PayjpClient }
}

const PAYJP_JS = 'https://js.pay.jp/v2/pay.js';

const BILLING_LABELS: Record<string, string> = {
  pending: '決済の確認中',
  active: '掲載中（毎月自動更新）',
  trial: '開始待ち',
  paused: 'お支払いが停止中',
  canceled: '解約予約済み（期間末まで掲載）',
  deleted: '契約終了',
};

/** payjp.js はカード入力欄を PAY.JP の iframe で描く（カード番号は CareLink を通らない）。読み込みは 1 回だけ。 */
function loadPayjp(): Promise<NonNullable<Window['Payjp']>> {
  if (window.Payjp) return Promise.resolve(window.Payjp);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PAYJP_JS}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => (window.Payjp ? resolve(window.Payjp) : reject(new Error('payjp.js unavailable'))));
    script.addEventListener('error', () => reject(new Error('payjp.js failed to load')));
    if (!existing) {
      script.src = PAYJP_JS;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export default function FeaturedAdsPage() {
  return <AdminFacilityScope title="広告・上位表示" path="/admin/featured-ads">{(scope) => <FeaturedAds {...scope} />}</AdminFacilityScope>;
}

// 広告枠は 2026年11月13日（点検 B2-1）から PAY.JP の月額サブスクで販売する。販売できるか（4 つの設定が
// 揃っているか）はサーバーが判定して GET の sales で返し、揃っていなければ「準備中」だけを出す。
function FeaturedAds({ facilityId, choices }: AdminFacilityScopeValue) {
  const [slots, setSlots] = useState<FeaturedSlot[]>([]);
  const [sales, setSales] = useState<Sales | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ area: '', business_type: '' });
  const [submitting, setSubmitting] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const payjpRef = useRef<{ client: PayjpClient; card: PayjpCardElement } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const r = await fetch(`/api/admin/featured-ads?facility_id=${encodeURIComponent(facilityId)}`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (cancelled) return;
        setSlots(d.slots || []);
        setSales(d.sales ?? { enabled: false });
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [facilityId, reloadKey]);

  const reload = useCallback(() => { setLoading(true); setReloadKey((k) => k + 1); }, []);

  // 申込フォームを開いたときだけ payjp.js を読み込み、カード入力欄を差し込む。
  const publicKey = sales?.enabled ? sales.publicKey : null;
  useEffect(() => {
    if (!showCreate || !publicKey) return;
    let disposed = false;
    loadPayjp().then((Payjp) => {
      if (disposed) return;
      const client = Payjp(publicKey);
      const card = client.elements().create('card');
      card.mount('#featured-ads-card');
      payjpRef.current = { client, card };
      setCardReady(true);
    }).catch(() => {
      if (!disposed) setToast({ type: 'error', message: 'カード入力欄を読み込めませんでした。再読み込みしてください' });
    });
    return () => {
      disposed = true;
      payjpRef.current?.card.unmount();
      payjpRef.current = null;
      setCardReady(false);
    };
  }, [showCreate, publicKey]);

  const hasContract = slots.some((s) => s.billing_status && ['pending', 'active', 'trial', 'paused', 'canceled'].includes(s.billing_status));

  const submit = async () => {
    const payjp = payjpRef.current;
    if (submitting || !payjp) return;
    setSubmitting(true);
    try {
      const tokenResult: { id?: string; error?: { message?: string } } = await payjp.client.createToken(payjp.card).catch(() => ({ error: {} }));
      if (!tokenResult.id) {
        setToast({ type: 'error', message: tokenResult.error?.message || 'カード情報を確認できませんでした' });
        return;
      }
      const res = await fetch('/api/admin/featured-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, token: tokenResult.id, area: form.area || null, business_type: form.business_type || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: 'error', message: data.error || '申込みに失敗しました' });
        return;
      }
      setSlots((prev) => [data.slot, ...prev]);
      setShowCreate(false);
      setToast({ type: 'success', message: 'お申し込みを受け付けました。決済の確認後に掲載が始まります' });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (slotId: string) => {
    if (canceling) return;
    setCanceling(slotId);
    try {
      const res = await fetch(`/api/admin/featured-ads?facility_id=${encodeURIComponent(facilityId)}&slot_id=${encodeURIComponent(slotId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setToast({ type: 'error', message: data.error || '解約できませんでした' }); return; }
      setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, billing_status: 'canceled' } : s)));
      setToast({ type: 'success', message: '解約を受け付けました。期間の終わりまで掲載されます' });
    } finally {
      setCanceling(null);
    }
  };

  const ctr = (slot: FeaturedSlot) =>
    slot.impressions > 0 ? ((slot.clicks / slot.impressions) * 100).toFixed(1) : '0.0';

  if (loading) {
    return (
      <div className="max-w-4xl space-y-6">
        <SbPageHeader title="広告・上位表示" description="検索結果の上位表示" />
        <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/featured-ads" />
        <div className="p-8 text-center text-gray-500">読み込み中...</div>
      </div>
    );
  }
  if (loadError || !sales) {
    return (
      <div className="max-w-4xl space-y-6">
        <SbPageHeader title="広告・上位表示" description="検索結果の上位表示" />
        <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/featured-ads" />
        <LoadError onRetry={reload} message="広告枠の読み込みに失敗しました" />
      </div>
    );
  }
  // 販売できない（PAY.JP の設定が揃っていない）間は、販売 UI を一切出さない。
  if (!sales.enabled) {
    return (
      <div className="max-w-4xl space-y-6">
        <SbPageHeader title="広告・上位表示" description="検索結果の上位表示・バナー広告枠" />
        <div className="bg-white rounded-xl border p-8 text-center text-gray-600">
          <p className="font-semibold text-gray-900">この機能は現在準備中です</p>
          <p className="mt-2 text-sm">有料掲載枠のお申し込みは現在受け付けておりません。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmCancel !== null}
        title="広告枠を解約しますか？"
        message="支払い済みの期間の終わりまでは掲載され、以後の請求は止まります。"
        confirmLabel="解約する"
        variant="danger"
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => { const id = confirmCancel; setConfirmCancel(null); if (id) void cancel(id); }}
      />
      <SbPageHeader
        title="広告・上位表示"
        description="検索結果の上位に店舗を表示します（月額・自動更新）"
        actions={hasContract ? undefined : (
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary px-4! py-2! text-sm">
            広告枠を申し込む
          </button>
        )}
      />
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/featured-ads" />

      <div className="bg-white rounded-xl border p-5">
        <div className="font-semibold text-gray-900">検索結果上位表示</div>
        <div className="text-2xl font-bold text-primary mt-2">
          ¥{sales.priceTaxIncluded.toLocaleString()}<span className="text-sm font-normal text-gray-500">/月（税込・税抜¥{sales.priceTaxExcluded.toLocaleString()}）</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">指定エリア・業種の検索結果の最上位に表示します。毎月同じ日に自動で更新・請求され、いつでも解約できます（解約後も支払い済みの期間の終わりまで掲載）。</p>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">広告枠を申し込む</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ads-area" className="block text-xs font-medium text-gray-700 mb-1">対象エリア（任意）</label>
              <input id="ads-area" type="text" value={form.area} maxLength={50} placeholder="例: 豊中市"
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="ads-business-type" className="block text-xs font-medium text-gray-700 mb-1">対象業種（任意）</label>
              <input id="ads-business-type" type="text" value={form.business_type} maxLength={50} placeholder="例: 鍼灸院"
                onChange={(e) => setForm((f) => ({ ...f, business_type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <p className="block text-xs font-medium text-gray-700 mb-1">クレジットカード</p>
            <div id="featured-ads-card" className="border rounded-lg px-3 py-3 bg-white min-h-[44px]" />
            <p className="text-xs text-gray-500 mt-1">カード情報は決済代行の PAY.JP に直接送られ、CareLink のサーバーには保存されません。</p>
          </div>
          <div className="bg-sky-50 rounded-lg p-4 text-sm">
            <div className="font-medium text-gray-900">お支払い：毎月 ¥{sales.priceTaxIncluded.toLocaleString()}（税込）</div>
            <p className="text-gray-600 text-xs mt-1">申し込むと初回分が請求され、決済の確認後に掲載が始まります。</p>
          </div>
          <div className="flex gap-3">
            <button type="button" disabled={submitting || !cardReady} onClick={submit} className="btn-primary px-4! py-2! text-sm">
              {submitting ? '処理中...' : `月額 ¥${sales.priceTaxIncluded.toLocaleString()}（税込）で申し込む`}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm border hover:bg-gray-50 transition-colors">
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">広告枠の契約</h2>
        </div>
        {slots.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>まだ広告枠がありません</p>
          </div>
        ) : (
          <div className="divide-y">
            {slots.map((slot) => (
              <div key={slot.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">検索結果上位表示</span>
                      <SbBadge tone={slot.is_active ? 'success' : 'neutral'}>{slot.is_active ? '掲載中' : '停止中'}</SbBadge>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 space-x-2">
                      {slot.billing_status && <span>{BILLING_LABELS[slot.billing_status] ?? slot.billing_status}</span>}
                      {slot.area && <span>エリア: {slot.area}</span>}
                      {slot.business_type && <span>業種: {businessTypeLabel(slot.business_type)}</span>}
                      {slot.current_period_end && <span>今期の終わり: {new Date(slot.current_period_end).toLocaleDateString('ja-JP')}</span>}
                    </div>
                    {slot.billing_status && ['active', 'trial', 'paused'].includes(slot.billing_status) && (
                      <button type="button" disabled={canceling === slot.id} onClick={() => setConfirmCancel(slot.id)}
                        className="mt-2 text-xs text-gray-600 underline hover:text-gray-900">
                        {canceling === slot.id ? '解約中...' : '解約する'}
                      </button>
                    )}
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
