'use client';

import { useState, useEffect } from 'react';

type Campaign = {
  id: string;
  campaign_type: 'owner_monthly' | 'user_digest' | 'user_coupon' | 'promo';
  subject: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  stats: { sent: number; opened: number; clicked: number; bounced: number };
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  owner_monthly: '施設オーナー月次',
  user_digest: 'ユーザーダイジェスト',
  user_coupon: 'クーポン配信',
  promo: 'プロモーション',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '下書き', color: 'bg-gray-100 text-gray-700' },
  scheduled: { label: '配信予定', color: 'bg-blue-100 text-blue-700' },
  sending: { label: '配信中', color: 'bg-yellow-100 text-yellow-700' },
  sent: { label: '配信済み', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-700' },
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

  useEffect(() => {
    fetch('/api/admin/newsletter')
      .then((r) => r.json())
      .then((d) => { setCampaigns(d.campaigns || []); setLoading(false); })
      .catch(() => setLoading(false));
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
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (id: string, action: 'schedule' | 'cancel' | 'send') => {
    const res = await fetch(`/api/admin/newsletter/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const data = await res.json();
      setCampaigns((prev) => prev.map((c) => c.id === id ? data.campaign : c));
    }
  };

  const openRate = (stats: Campaign['stats']) =>
    stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;

  const clickRate = (stats: Campaign['stats']) =>
    stats.opened > 0 ? Math.round((stats.clicked / stats.opened) * 100) : 0;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ニュースレター管理</h1>
          <p className="text-sm text-gray-500 mt-1">施設オーナー向け月次メール・ユーザー向けメルマガを管理</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 transition-colors"
        >
          新規キャンペーン作成
        </button>
      </div>

      {result && (
        <div className={`p-4 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {result.message}
          <button onClick={() => setResult(null)} className="ml-2 underline">閉じる</button>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: '総キャンペーン', value: campaigns.length },
          { label: '配信済み', value: campaigns.filter((c) => c.status === 'sent').length },
          { label: '予定', value: campaigns.filter((c) => c.status === 'scheduled').length },
          { label: '下書き', value: campaigns.filter((c) => c.status === 'draft').length },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border p-4">
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">新規キャンペーン</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">タイプ</label>
              <select
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
              <label className="block text-xs font-medium text-gray-700 mb-1">配信予定日時（任意）</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">件名 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="例: 【CareLink】4月の施設オーナー様向けニュースレター"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">HTMLコンテンツ <span className="text-red-500">*</span></label>
            <textarea
              value={form.html_content}
              onChange={(e) => setForm((f) => ({ ...f, html_content: e.target.value }))}
              placeholder="<p>こんにちは...</p>"
              rows={8}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">プレーンテキスト（任意）</label>
            <textarea
              value={form.text_content}
              onChange={(e) => setForm((f) => ({ ...f, text_content: e.target.value }))}
              placeholder="メールをテキストで読む方向け"
              rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !form.subject || !form.html_content}
              className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {creating ? '作成中...' : '作成する'}
            </button>
            <button
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
                      <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">
                        {TYPE_LABELS[c.campaign_type]}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_LABELS[c.status].color}`}>
                        {STATUS_LABELS[c.status].label}
                      </span>
                    </div>
                    <div className="font-medium text-gray-900 mt-1 truncate">{c.subject}</div>
                    <div className="text-xs text-gray-500 mt-1 space-x-3">
                      {c.scheduled_at && <span>予定: {new Date(c.scheduled_at).toLocaleString('ja-JP')}</span>}
                      {c.sent_at && <span>送信: {new Date(c.sent_at).toLocaleString('ja-JP')}</span>}
                      <span>作成: {new Date(c.created_at).toLocaleDateString('ja-JP')}</span>
                    </div>
                    {c.status === 'sent' && (
                      <div className="mt-2 flex gap-4 text-xs text-gray-600">
                        <span>送信 <strong>{c.stats.sent}</strong></span>
                        <span>開封率 <strong>{openRate(c.stats)}%</strong></span>
                        <span>クリック率 <strong>{clickRate(c.stats)}%</strong></span>
                        <span>バウンス <strong>{c.stats.bounced}</strong></span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {c.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleAction(c.id, 'send')}
                          className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg hover:bg-green-600 transition-colors"
                        >
                          今すぐ配信
                        </button>
                        {c.scheduled_at && (
                          <button
                            onClick={() => handleAction(c.id, 'schedule')}
                            className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg hover:bg-blue-600 transition-colors"
                          >
                            予約配信
                          </button>
                        )}
                      </>
                    )}
                    {c.status === 'scheduled' && (
                      <button
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
          ユーザーはメール末尾の配信停止リンクからいつでも解除可能です（CAN-SPAM法準拠）。
          解除リクエストは自動的に <code className="bg-gray-100 px-1 rounded text-xs">newsletter_subscriptions</code> テーブルに反映されます。
        </p>
        <div className="mt-4 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
          <strong>オーナー向け月次レポート</strong>は毎月1日に自動生成・配信されます。
          Cronジョブ: <code className="bg-white/50 px-1 rounded text-xs">/api/cron/newsletter-digest</code>
        </div>
      </div>
    </div>
  );
}
