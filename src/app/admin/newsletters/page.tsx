'use client';

import { useState, useEffect, useRef } from 'react';
import { SbBadge, SbPageHeader, SbStatCard, type SbBadgeTone } from '@/components/admin/SbUi';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

type Campaign = {
  id: string;
  campaign_type: 'owner_monthly' | 'user_digest' | 'user_coupon' | 'promo';
  subject: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  stats: { sent: number; opened: number; clicked: number; bounced: number; delivery_mode?: string; total?: number; queued?: number; unconfirmed?: number; accepted?: number; suppressed?: number; failed?: number };
  updated_at: string;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  owner_monthly: '施設オーナー月次',
  user_digest: 'ユーザーダイジェスト',
  user_coupon: 'クーポン配信',
  promo: 'プロモーション',
};

const STATUS_LABELS: Record<string, { label: string; tone: SbBadgeTone }> = {
  draft: { label: '下書き', tone: 'neutral' },
  scheduled: { label: '配信予定', tone: 'info' },
  sending: { label: '受付・結果確認中', tone: 'warning' },
  sent: { label: '処理完了', tone: 'success' },
  cancelled: { label: 'キャンセル', tone: 'danger' },
};

export default function NewslettersPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    campaign_type: 'owner_monthly' as Campaign['campaign_type'],
    subject: '',
    html_content: '',
    text_content: '',
    scheduled_at: '',
  });
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 「今すぐ配信」は不可逆な一斉メール送信のため確認ダイアログを挟む。送信対象キャンペーンID。
  const [sendConfirmId, setSendConfirmId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    fetch('/api/admin/newsletter')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setCampaigns(d.campaigns || []); setLoading(false); })
      .catch(() => { setLoading(false); setResult({ ok: false, message: '一覧を取得できませんでした。受付状況は未確認です。' }); });
  }, []);

  const handleCreate = async () => {
    if (!form.subject || !form.html_content) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setCampaigns((prev) => [data.campaign, ...prev]);
        setShowCreate(false);
        setForm({ campaign_type: 'owner_monthly', subject: '', html_content: '', text_content: '', scheduled_at: '' });
        setResult({ ok: true, message: 'キャンペーンを作成しました' });
      } else {
        setResult({ ok: false, message: data.error || '作成に失敗しました' });
      }
    } catch {
      setResult({ ok: false, message: '作成結果を確認できません。一覧を確認してから操作してください。' });
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (id: string, action: 'schedule' | 'cancel' | 'send' | 'inspect') => {
    try {
      const observed = campaigns.find(c => c.id === id);
      const res = await fetch(`/api/admin/newsletter/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expected_updated_at: observed?.updated_at }),
      });
      const data = await res.json();
      if (res.ok) {
        setCampaigns(prev => prev.map(c => c.id === id ? data.campaign : c));
        if (data.message) setResult({ ok: true, message: data.message });
      } else {
        setResult({ ok: false, message: data.error || '操作に失敗しました' });
      }
    } catch {
      setResult({ ok: false, message: '受付結果を確認できません。同じキャンペーンの「受付状況を確認」から照合してください。' });
    }
  };

  const handleConfirmSend = async () => {
    if (!sendConfirmId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await handleAction(sendConfirmId, 'send');
    } finally {
      sendingRef.current = false;
      setSending(false);
      setSendConfirmId(null);
    }
  };

  const sendConfirmSubject = campaigns.find((c) => c.id === sendConfirmId)?.subject ?? '';

  return (
    <div className="max-w-5xl space-y-6">
      <SbPageHeader
        title="ニュースレター管理"
        description="施設オーナー向け月次メール・ユーザー向けメルマガを管理"
        actions={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="btn-primary px-4! py-2! text-sm"
          >
            新規キャンペーン作成
          </button>
        }
      />

      {result && (
        <Toast
          type={result.ok ? 'success' : 'error'}
          message={result.message}
          onClose={() => setResult(null)}
        />
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SbStatCard label="総キャンペーン" value={campaigns.length} unit="件" accent="sky" />
        <SbStatCard label="処理完了" value={campaigns.filter((c) => c.status === 'sent').length} unit="件" accent="emerald" />
        <SbStatCard label="予定" value={campaigns.filter((c) => c.status === 'scheduled').length} unit="件" accent="amber" />
        <SbStatCard label="下書き" value={campaigns.filter((c) => c.status === 'draft').length} unit="件" accent="gray" />
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">新規キャンペーン</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="nl-type" className="block text-xs font-medium text-gray-700 mb-1">タイプ</label>
              <select
                id="nl-type"
                value={form.campaign_type}
                onChange={(e) => setForm((f) => ({ ...f, campaign_type: e.target.value as Campaign['campaign_type'] }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="nl-scheduled" className="block text-xs font-medium text-gray-700 mb-1">配信予定日時（任意）</label>
              <input
                id="nl-scheduled"
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="nl-subject" className="block text-xs font-medium text-gray-700 mb-1">件名 <span className="text-red-500">*</span></label>
            <input
              id="nl-subject"
              type="text"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="例：【CareLink】4月の施設オーナー様向けニュースレター"
              maxLength={200}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="nl-html" className="block text-xs font-medium text-gray-700 mb-1">HTMLコンテンツ <span className="text-red-500">*</span></label>
            <textarea
              id="nl-html"
              value={form.html_content}
              onChange={(e) => setForm((f) => ({ ...f, html_content: e.target.value }))}
              placeholder="<p>こんにちは...</p>"
              rows={8}
              maxLength={5000}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="nl-text" className="block text-xs font-medium text-gray-700 mb-1">プレーンテキスト（任意）</label>
            <textarea
              id="nl-text"
              value={form.text_content}
              onChange={(e) => setForm((f) => ({ ...f, text_content: e.target.value }))}
              placeholder="メールをテキストで読む方向け"
              rows={4}
              maxLength={5000}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !form.subject || !form.html_content}
              className="btn-primary px-4! py-2! text-sm"
            >
              {creating ? '作成中...' : '作成する'}
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

      {/* Campaign list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">キャンペーン一覧</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">読み込み中...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-gray-400">まだキャンペーンがありません</div>
        ) : (
          <div className="divide-y">
            {campaigns.map((c) => (
              <div key={c.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SbBadge tone="info">
                        {TYPE_LABELS[c.campaign_type]}
                      </SbBadge>
                      <SbBadge tone={STATUS_LABELS[c.status].tone}>
                        {STATUS_LABELS[c.status].label}
                      </SbBadge>
                    </div>
                    <div className="font-medium text-gray-900 mt-1 truncate">{c.subject}</div>
                    <div className="text-xs text-gray-500 mt-1 space-x-3">
                      {c.scheduled_at && <span>予定：{new Date(c.scheduled_at).toLocaleString('ja-JP')}</span>}
                      {c.sent_at && <span>処理完了：{new Date(c.sent_at).toLocaleString('ja-JP')}</span>}
                      <span>作成：{new Date(c.created_at).toLocaleDateString('ja-JP')}</span>
                    </div>
                    {c.stats.delivery_mode === 'newsletter_outbox_v1' ? (
                      <div className="mt-2 text-xs text-gray-600 space-y-1">
                        <p>対象 {c.stats.total} / 待機 {c.stats.queued} / 結果未確認 {c.stats.unconfirmed} / 提供元受理 {c.stats.accepted} / 配信停止・対象外 {c.stats.suppressed} / 失敗 {c.stats.failed}</p>
                        <p>提供元の受理はメール到達の確認ではありません。開封・クリックは未計測です。</p>
                      </div>
                    ) : c.status === 'sent' || c.status === 'sending' ? (
                      <p className="mt-2 text-xs text-gray-600">旧方式の記録です。実際の到達・開封は未確認です。結果不明の配信は自動再送しません。</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className="text-xs border rounded-lg px-3 py-1" onClick={() => handleAction(c.id, 'inspect')}>受付状況を確認</button>
                    {c.status === 'draft' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setSendConfirmId(c.id)}
                          className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg hover:bg-green-600 transition-colors"
                        >
                          今すぐ配信
                        </button>
                        {c.scheduled_at && (
                          <button
                            type="button"
                            onClick={() => handleAction(c.id, 'schedule')}
                            className="text-xs bg-sky-600 text-white px-3 py-1 rounded-lg hover:bg-sky-700 transition-colors"
                          >
                            予約配信
                          </button>
                        )}
                      </>
                    )}
                    {c.status === 'scheduled' && (
                      <button
                        type="button"
                        onClick={() => handleAction(c.id, 'cancel')}
                        className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 transition-colors"
                      >
                        キャンセル
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subscription stats */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">配信停止管理</h2>
        <p className="text-sm text-gray-600">
          ユーザーはメール末尾の配信停止リンクから解除できます。アカウントの配信停止設定と購読設定を照合し、送信開始直前にも対象か確認します。
        </p>
        <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
          <strong>ニュースレターは手動配信のみ</strong>です（自動の月次配信は廃止しました）。
          お知らせがある時に、この画面で件名・本文を作成して「今すぐ配信」してください。
        </div>
      </div>

      <ConfirmDialog
        open={sendConfirmId !== null}
        title="送信キューに登録しますか？"
        message={`「${sendConfirmSubject}」の宛先と本文を確定して送信キューに登録します。送信開始後は取り消せません。メール到達は別途確認が必要です。`}
        confirmLabel={sending ? '受付中...' : 'キューに登録する'}
        confirmDisabled={sending}
        onConfirm={handleConfirmSend}
        onCancel={() => { if (!sending) setSendConfirmId(null); }}
      />
    </div>
  );
}
