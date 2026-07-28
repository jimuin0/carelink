'use client';

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface Contact {
  id: string;
  created_at: string;
  name: string;
  email: string | null;
  phone: string | null;
  inquiry_type: string | null;
  message: string | null;
  ticket_status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  ticket_notes: string | null;
  resolved_at: string | null;
}

const TICKET_STATUS_CONFIG = {
  open:        { label: '新着', className: 'bg-sky-100 text-sky-700' },
  in_progress: { label: '対応中', className: 'bg-amber-100 text-amber-700' },
  waiting:     { label: '返信待ち', className: 'bg-purple-100 text-purple-700' },
  resolved:    { label: '解決済み', className: 'bg-emerald-100 text-emerald-700' },
  closed:      { label: 'クローズ', className: 'bg-gray-100 text-gray-500' },
};

const PRIORITY_CONFIG = {
  low:    { label: '低', className: 'text-gray-400' },
  normal: { label: '通常', className: 'text-blue-500' },
  high:   { label: '高', className: 'text-amber-500' },
  urgent: { label: '緊急', className: 'text-red-600 font-bold' },
};

export default function AdminInquiriesPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // 返信本文（問い合わせIDごと）と送信中の対象。
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    let query = supabase
      .from('contacts')
      .select('id, created_at, name, email, phone, inquiry_type, message, ticket_status, priority, ticket_notes, resolved_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (statusFilter) query = query.eq('ticket_status', statusFilter);
    setLoadError(false);
    const { data, error } = await query;
    if (error) { setLoadError(true); setLoading(false); return; }
    setContacts((data ?? []) as Contact[]);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const updateTicket = async (
    id: string,
    updates: Partial<Pick<Contact, 'ticket_status' | 'priority' | 'ticket_notes'>>
  ) => {
    if (savingId) return; // 二重送信ガード（select 連続変更による順不同 PATCH 競合を防止）
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        setToast({ type: 'error', message: '更新に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: '更新しました' });
      load();
    } finally {
      setSavingId(null);
    }
  };

  /**
   * 【2026年7月28日 新設】問い合わせへの返信を CareLink から直接送る。
   * 以前は mailto: リンクで担当者のメールアプリを開いており、返信が担当者個人の
   * アドレスから送られていた（/legal に support@carelink-jp.com を載せているのに
   * 別アドレスから返事が届く状態）。API 経由なら差出人が必ず運営アドレスに固定される。
   */
  const sendReply = async (id: string) => {
    const body = (replyBodies[id] ?? '').trim();
    if (!body || replyingId) return;
    setReplyingId(id);
    try {
      const res = await fetch(`/api/admin/inquiries/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        // 送信失敗時は本文を消さない（書き直しをさせない）。
        const data = await res.json().catch(() => null);
        setToast({ type: 'error', message: data?.error || '返信の送信に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: '返信を送信しました' });
      setReplyBodies((prev) => ({ ...prev, [id]: '' }));
      load();
    } finally {
      setReplyingId(null);
    }
  };

  const openCount = contacts.filter(c => c.ticket_status === 'open').length;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">問い合わせ管理</h1>
          {openCount > 0 && statusFilter === 'open' && (
            <p className="text-sm text-sky-600 mt-0.5">{openCount}件の新着問い合わせ</p>
          )}
        </div>
        <button type="button" onClick={load} className="text-sm px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200">更新</button>
      </div>

      {/* ステータスフィルター */}
      <div className="flex flex-wrap gap-2">
        {(['open', 'in_progress', 'waiting', 'resolved', 'closed', ''] as const).map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              statusFilter === s
                ? 'bg-sky-500 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === '' ? 'すべて' : TICKET_STATUS_CONFIG[s as keyof typeof TICKET_STATUS_CONFIG]?.label ?? s}
          </button>
        ))}
      </div>

      {/* チケット一覧 */}
      {loading ? (
        <div className="py-12 text-center">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <LoadError onRetry={load} message="問い合わせの読み込みに失敗しました" />
      ) : contacts.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
          {statusFilter === 'open' ? '新着の問い合わせはありません' : '問い合わせがありません'}
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* ヘッダー行 */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TICKET_STATUS_CONFIG[c.ticket_status].className}`}>
                      {TICKET_STATUS_CONFIG[c.ticket_status].label}
                    </span>
                    <span className={`text-xs ${PRIORITY_CONFIG[c.priority].className}`}>
                      [{PRIORITY_CONFIG[c.priority].label}]
                    </span>
                    {c.inquiry_type && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{c.inquiry_type}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.email}{c.phone ? ` / ${c.phone}` : ''}</p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform ${expandedId === c.id ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* 展開エリア */}
              {expandedId === c.id && (
                <div className="border-t border-gray-100 p-4 space-y-4">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{c.message}</p>

                  {/* ステータス・優先度変更 */}
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={c.ticket_status}
                      disabled={savingId !== null}
                      onChange={(e) => updateTicket(c.id, { ticket_status: e.target.value as Contact['ticket_status'] })}
                      className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {Object.entries(TICKET_STATUS_CONFIG).map(([val, { label }]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <select
                      value={c.priority}
                      disabled={savingId !== null}
                      onChange={(e) => updateTicket(c.id, { priority: e.target.value as Contact['priority'] })}
                      className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {Object.entries(PRIORITY_CONFIG).map(([val, { label }]) => (
                        <option key={val} value={val}>優先度: {label}</option>
                      ))}
                    </select>
                  </div>

                  {/* 内部メモ */}
                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 block">内部メモ</label>
                    <textarea
                      value={editingNotes[c.id] ?? (c.ticket_notes || '')}
                      onChange={(e) => setEditingNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      rows={2}
                      placeholder="対応履歴・メモを記入..."
                      maxLength={2000}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                    />
                    <button
                      type="button"
                      disabled={savingId !== null}
                      onClick={() => updateTicket(c.id, { ticket_notes: editingNotes[c.id] ?? c.ticket_notes ?? '' })}
                      className="mt-1 text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      メモを保存
                    </button>
                  </div>

                  {/* 返信フォーム（CareLink から直接送信・差出人は運営アドレスに固定） */}
                  {c.email ? (
                    <div className="border-t border-gray-100 pt-4">
                      <label htmlFor={`reply-${c.id}`} className="block text-xs font-bold text-gray-600 mb-1.5">
                        {c.name} 様に返信
                      </label>
                      <textarea
                        id={`reply-${c.id}`}
                        value={replyBodies[c.id] ?? ''}
                        onChange={(e) => setReplyBodies((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        rows={5}
                        className="form-input w-full text-sm"
                      />
                      <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                        <p className="text-xs text-gray-400">
                          差出人は CareLink 運営アドレスになります（{c.email} 宛）
                        </p>
                        <button
                          type="button"
                          onClick={() => sendReply(c.id)}
                          disabled={!(replyBodies[c.id] ?? '').trim() || replyingId === c.id}
                          className="btn-primary gap-1.5 text-sm !px-4 !py-2 disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {replyingId === c.id ? '送信中...' : '返信を送信'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="border-t border-gray-100 pt-4 text-xs text-gray-400">
                      メールアドレスの登録が無いため、この問い合わせにはメール返信できません。
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
