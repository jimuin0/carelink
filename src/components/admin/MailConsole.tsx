'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { inquiryListResponse, type InquiryListRow } from '@/lib/admin-inquiry-list-contract';
import { PLATFORM_MAIL_FROM, PLATFORM_MAIL_REPLY_TO, buildPlatformMailEnvelope, mailJapanTime, mailTimeLabel,
  platformMailRecordSchema, platformMailContactSchema, type PlatformMailRecord, type PlatformMailDraft, type PlatformMailContact } from '@/lib/platform-mail-contract';

type Folder = 'inbox' | 'draft' | 'scheduled' | 'sent' | 'pending';
const folders: { id: Folder; label: string; icon: string }[] = [
  { id: 'inbox', label: 'お問い合わせ', icon: '⌑' }, { id: 'draft', label: '下書き', icon: '✎' },
  { id: 'scheduled', label: '送信予約', icon: '◷' }, { id: 'sent', label: '送信済み', icon: '↗' },
  { id: 'pending', label: '要確認', icon: '!' },
];
const labels: Record<PlatformMailRecord['state'], string> = { draft: '下書き', pending: '送信結果の確認が必要', scheduled: '送信予約済み', sent: '送信済み', cancelling: '取り消し結果を確認中', cancelled: '予約を取り消しました' };
const deliveryLabels: Record<string, string> = { accepted: '送信受付済み', scheduled: '送信待ち', sent: '送信済み', delivered: '配信完了', delayed: '配信に遅れがあります', bounced: '宛先へ届けられませんでした', complained: '迷惑メールの報告あり', cancelled: '取り消し済み', failed: '配信失敗' };
const listSchema = z.object({ messages: z.array(platformMailRecordSchema), nextCursor: z.object({ at: z.string(), id: z.uuid() }).nullable() });
const replySchema = z.object({ mail: platformMailRecordSchema, warning: z.string().optional(), providerId: z.uuid().optional() });
const inputClass = 'form-input w-full min-w-0';
const errorMessage = (error: unknown, fallback: string) => error instanceof Error && !(error instanceof TypeError) && !(error instanceof z.ZodError) ? error.message : fallback;
const fromRecord = (mail: PlatformMailRecord): PlatformMailDraft => ({ id: mail.id, revision: mail.revision, contactId: mail.contact_id,
  to: mail.recipient, subject: mail.subject, body: mail.body, scheduledAt: mail.scheduled_at });

export default function MailConsole({ initialContactId }: { initialContactId?: string }) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [contacts, setContacts] = useState<InquiryListRow[]>([]);
  const [messages, setMessages] = useState<PlatformMailRecord[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [contact, setContact] = useState<PlatformMailContact | null>(null);
  const [mail, setMail] = useState<PlatformMailRecord | null>(null);
  const [composer, setComposer] = useState<PlatformMailDraft | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<PlatformMailRecord | null>(null);
  const [cancelPreview, setCancelPreview] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [providerId, setProviderId] = useState<string | undefined>();
  const requestSequence = useRef(0);
  const selectionSequence = useRef(0);
  const dirty = composer !== null && JSON.stringify(composer) !== saved;

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const load = useCallback(async (after: unknown = null) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setLoadError(false);
    try {
      const query = new URLSearchParams(folder === 'inbox' ? { status: 'all' } : { folder });
      if (after !== null) query.set('cursor', JSON.stringify(after));
      const response = await fetch((folder === 'inbox' ? '/api/admin/inquiries?' : '/api/admin/mail?') + query, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (sequence !== requestSequence.current) return;
      if (response.status === 403 || response.status === 401) { setForbidden(true); setContacts([]); setMessages([]); return; }
      if (!response.ok) throw new Error('list unavailable');
      const data: unknown = await response.json();
      if (sequence !== requestSequence.current) return;
      if (folder === 'inbox') {
        const result = inquiryListResponse.parse(data);
        setContacts(current => after === null ? result.contacts : [...new Map([...current, ...result.contacts].map(item => [item.id, item])).values()]);
        setCursor(result.nextCursor);
      } else {
        const result = listSchema.parse(data);
        setMessages(current => after === null ? result.messages : [...new Map([...current, ...result.messages].map(item => [item.id, item])).values()]);
        setCursor(result.nextCursor);
      }
      setForbidden(false);
    } catch { if (sequence === requestSequence.current) setLoadError(true); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [folder]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; requestSequence.current += 1; };
  }, [load, refresh]);
  useEffect(() => {
    if (!initialContactId) return;
    let active = true;
    const selectedAt = selectionSequence.current;
    void fetch('/api/admin/mail?contactId=' + encodeURIComponent(initialContactId), { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      .then(async response => { if (!response.ok) throw new Error('contact unavailable'); return response.json(); })
      .then(data => { if (active && selectedAt === selectionSequence.current) setContact(platformMailContactSchema.parse(data.contact)); })
      .catch(() => { if (active && selectedAt === selectionSequence.current) setNotice('お問い合わせを開けませんでした。一覧から選び直してください。'); });
    return () => { active = false; };
  }, [initialContactId]);

  const navigate = (action: () => void) => {
    if (busy) return;
    const proceed = () => { selectionSequence.current += 1; setNotice(''); setPreview(null); setProviderId(undefined); action(); };
    if (dirty) setPendingNavigation(() => proceed); else proceed();
  };
  const clearSelection = () => { setMail(null); setContact(null); setComposer(null); setSaved(''); };
  const openMail = (item: PlatformMailRecord) => {
    navigate(() => {
    setContact(null); setMail(item);
    const draft = item.state === 'draft' ? fromRecord(item) : null;
    setComposer(draft); setSaved(draft === null ? '' : JSON.stringify(draft));
    });
  };
  const compose = (reply?: PlatformMailContact) => {
    navigate(() => {
    const draft: PlatformMailDraft = { id: crypto.randomUUID(), revision: 0, contactId: reply?.id ?? null,
      to: reply?.email ?? '', subject: reply ? '【CareLink】お問い合わせへのご返信' : '', body: '', scheduledAt: null };
    setContact(reply ?? null); setMail(null); setComposer(draft); setSaved(JSON.stringify(draft));
    });
  };
  const request = async (command: Record<string, unknown>): Promise<PlatformMailRecord> => {
    const response = await fetch('/api/admin/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(35000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '保存・送信の結果を確認できませんでした。');
    const result = replySchema.parse(data);
    const expectedId = command.action === 'save' ? (command.draft as PlatformMailDraft).id : command.id;
    if (result.mail.id !== expectedId) throw new Error('対象メールの保存結果を確認できませんでした。');
    setNotice(result.warning ?? ''); setProviderId(result.providerId); setMail(result.mail);
    if (result.mail.state === 'draft') { const draft = fromRecord(result.mail); setComposer(draft); setSaved(JSON.stringify(draft)); }
    else { setComposer(null); setSaved(''); }
    setRefresh(value => value + 1);
    return result.mail;
  };
  const save = async (forPreview = false) => {
    if (!composer || busy) return;
    setBusy(true); setNotice('');
    try {
      if (forPreview) buildPlatformMailEnvelope(composer);
      const record = await request({ action: 'save', draft: composer });
      if (forPreview) setPreview(record); else setNotice('下書きを保存しました。');
    } catch (error) { setNotice(errorMessage(error, '宛先・件名・本文と通信状態をご確認ください。入力内容は保持されています。')); }
    finally { setBusy(false); }
  };
  const operate = async (action: 'send' | 'refresh' | 'cancel', record: PlatformMailRecord) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      await request({ action, id: record.id, ...(action === 'send' ? { revision: record.revision } : {}), ...(action === 'refresh' && providerId ? { providerId } : {}) });
      setPreview(null); setCancelPreview(false);
    } catch (error) { setNotice(errorMessage(error, '送信状況を確認できませんでした。作り直さず、同じ送信操作の状況をご確認ください。')); }
    finally { setBusy(false); }
  };
  const selected = composer !== null || contact !== null || mail !== null;

  if (forbidden) return <section className="rounded-xl border bg-white p-6" role="alert"><h1 className="text-xl font-bold">運営アカウントでログインしてください</h1><p className="mt-3">このメール画面はCareLink運営専用です。</p><Link className="mt-4 inline-block underline" href="/auth/login?redirect=%2Fadmin%2Fmail">ログイン画面へ</Link></section>;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">メール</h1><p className="mt-1 text-sm text-gray-600">差出人：{PLATFORM_MAIL_FROM}</p></div><button type="button" className="btn-primary" disabled={busy} onClick={() => compose()}>＋ 新規作成</button></header>
    {notice && <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm leading-6">{notice}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[160px_280px_minmax(0,1fr)]">
      <nav aria-label="メールのフォルダー" className="flex gap-2 overflow-x-auto xl:flex-col">{folders.map(item => <button key={item.id} type="button" aria-pressed={folder === item.id} disabled={busy} className={'shrink-0 rounded-lg px-4 py-3 text-left text-sm font-medium ' + (folder === item.id ? 'bg-sky-100 text-sky-900' : 'bg-white text-gray-700 hover:bg-gray-50')} onClick={() => navigate(() => { clearSelection(); setFolder(item.id); setCursor(null); setContacts([]); setMessages([]); })}><span aria-hidden="true" className="mr-2">{item.icon}</span>{item.label}</button>)}</nav>
      <section className={'min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white ' + (selected ? 'hidden xl:block' : '')} aria-label="メール一覧" aria-busy={loading}>
        <div className="flex items-center justify-between border-b p-3"><h2 className="font-bold">{folders.find(item => item.id === folder)!.label}</h2><button type="button" className="rounded px-3 py-2 text-sm text-sky-800 disabled:opacity-50" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>一覧を更新</button></div>
        {loading && <p className="p-4 text-sm" role="status">読み込んでいます…</p>}
        {loadError && <p className="p-4 text-sm text-red-700" role="alert">一覧を読み込めませんでした。「一覧を更新」でもう一度お試しください。</p>}
        {!loading && !loadError && (folder === 'inbox' ? contacts : messages).length === 0 && <p className="p-6 text-sm text-gray-500">メールはありません。</p>}
        <ul className="divide-y divide-gray-100">{folder === 'inbox' ? contacts.map(item => <li key={item.id}><button type="button" disabled={busy} className="w-full p-4 text-left hover:bg-sky-50" onClick={() => navigate(() => { clearSelection(); setContact(item); })}><p className="truncate font-semibold">{item.name}</p><p className="mt-1 truncate text-sm text-gray-700">{item.inquiry_type ?? 'お問い合わせ'}</p><p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-gray-500">{item.message}</p></button></li>) : messages.map(item => <li key={item.id}><button type="button" disabled={busy} className="w-full p-4 text-left hover:bg-sky-50" onClick={() => openMail(item)}><p className="truncate font-semibold">{item.subject || '（件名なし）'}</p><p className="mt-1 truncate text-sm text-gray-600">{item.recipient || '宛先未入力'}</p><p className="mt-2 text-xs text-gray-500">{labels[item.state]} · {mailTimeLabel(item.updated_at)}</p></button></li>)}</ul>
        {cursor !== null && <button type="button" disabled={loading || busy} className="w-full p-4 text-sm text-sky-800" onClick={() => void load(cursor)}>さらに表示</button>}
      </section>
      <section className={'min-w-0 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 ' + (!selected ? 'hidden xl:block' : '')} aria-label="メールの内容">
        {!selected && <p className="py-16 text-center text-sm text-gray-500">メールを選ぶか、新規作成してください。</p>}
        {selected && <button type="button" className="mb-5 rounded py-2 text-sm text-sky-800 xl:hidden" disabled={busy} onClick={() => navigate(clearSelection)}>← 一覧へ戻る</button>}
        {contact && !composer && !mail && <><h2 className="text-lg font-bold">{contact.name} 様</h2><p className="mt-2 break-all text-sm text-gray-600">{contact.email ?? 'メールアドレスなし'}</p><p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7">{contact.message}</p><div className="mt-6 flex flex-wrap items-center gap-4"><button type="button" className="btn-primary" disabled={!contact.email || busy} onClick={() => compose(contact)}>返信を書く</button><Link href="/admin/inquiries" className="text-sm underline">問い合わせの対応履歴</Link></div></>}
        {composer && <form onSubmit={event => { event.preventDefault(); void save(true); }}>
          <fieldset disabled={busy} className="space-y-5">
            <div><label htmlFor="operator-mail-to" className="mb-2 block text-sm font-medium">宛先</label><input id="operator-mail-to" type="email" autoComplete="off" maxLength={254} className={inputClass} readOnly={composer.contactId !== null} value={composer.to} onChange={event => setComposer({ ...composer, to: event.target.value })} />{composer.contactId !== null && <p className="mt-1.5 text-xs text-gray-500">お問い合わせに登録された返信先です。</p>}</div>
            <div><label htmlFor="operator-mail-subject" className="mb-2 block text-sm font-medium">件名</label><input id="operator-mail-subject" maxLength={200} className={inputClass} value={composer.subject} onChange={event => setComposer({ ...composer, subject: event.target.value })} /></div>
            <div><label htmlFor="operator-mail-body" className="mb-2 block text-sm font-medium">本文</label><textarea id="operator-mail-body" rows={14} maxLength={10000} className={inputClass + ' leading-7'} value={composer.body} onChange={event => setComposer({ ...composer, body: event.target.value })} /></div>
            <div><label htmlFor="operator-mail-time" className="mb-2 block text-sm font-medium">送信日時（任意・日本時間）</label><input id="operator-mail-time" type="datetime-local" className={inputClass} value={composer.scheduledAt === null ? '' : new Date(Date.parse(composer.scheduledAt) + 9 * 3600000).toISOString().slice(0, 16)} onChange={event => { try { setComposer({ ...composer, scheduledAt: mailJapanTime(event.target.value) }); } catch { setNotice('送信日時を確認してください。'); } }} /><p className="mt-1.5 text-xs leading-5 text-gray-500">空欄なら今すぐ送信。予約は1分後から30日以内で指定できます。</p></div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-5"><button type="submit" className="btn-primary">{busy ? '確認中…' : composer.scheduledAt ? '予約内容を確認' : '送信内容を確認'}</button><button type="button" className="btn-secondary" onClick={() => void save()}>下書き保存</button><span className="text-xs text-gray-500">{dirty ? '未保存の変更があります' : composer.revision > 0 ? '保存済み' : ''}</span></div>
          </fieldset>
        </form>}
        {mail && !composer && <><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="break-words text-lg font-bold">{mail.subject}</h2><span className="rounded-full bg-gray-100 px-3 py-1 text-xs">{labels[mail.state]}</span></div><dl className="mt-5 space-y-2 text-sm"><div><dt className="inline text-gray-500">宛先：</dt><dd className="inline break-all">{mail.recipient}</dd></div><div><dt className="inline text-gray-500">返信先：</dt><dd className="inline">{PLATFORM_MAIL_REPLY_TO}</dd></div>{mail.scheduled_at && <div><dt className="inline text-gray-500">指定日時：</dt><dd className="inline">{mailTimeLabel(mail.scheduled_at)}（日本時間）</dd></div>}{mail.delivery_status && <div><dt className="inline text-gray-500">配信状況：</dt><dd className="inline">{deliveryLabels[mail.delivery_status] ?? '確認が必要です'}</dd></div>}</dl><p className="mt-6 whitespace-pre-wrap break-words text-sm leading-7">{mail.body}</p><div className="mt-6 flex flex-wrap gap-3 border-t pt-5">{['pending', 'scheduled', 'sent', 'cancelling'].includes(mail.state) && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void operate(mail.state === 'pending' && !providerId && !mail.provider_message_id ? 'send' : 'refresh', mail)}>送信状況を確認</button>}{['scheduled', 'cancelling'].includes(mail.state) && <button type="button" className="btn-secondary" disabled={busy} onClick={() => setCancelPreview(true)}>予約を取り消す</button>}</div>{mail.state === 'pending' && <p className="mt-4 text-sm leading-6 text-amber-800">結果が不明なため、内容を固定しています。別のメールとして作り直さず、この送信操作の状況を確認してください。</p>}</>}
      </section>
    </div>
    <p className="text-xs leading-5 text-gray-500">お問い合わせフォームの受信と、この画面で作成したメールを表示しています。受信メール全体のメールボックスではありません。</p>
    <ConfirmDialog open={pendingNavigation !== null} title="未保存の変更があります" message="保存せずに移動しますか？" confirmLabel="保存せずに移動" cancelLabel="編集を続ける" onCancel={() => setPendingNavigation(null)} onConfirm={() => { pendingNavigation?.(); setPendingNavigation(null); }} />
    <Modal open={preview !== null} title="送信内容の確認" onClose={() => { if (!busy) setPreview(null); }} footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setPreview(null)}>戻る</button><button type="button" className="btn-primary" disabled={busy || preview === null} onClick={() => { if (preview) void operate('send', preview); }}>{busy ? '処理中…' : preview?.scheduled_at ? '予約送信を確定' : 'この内容で送信'}</button></div>}>
      {preview && <div className="space-y-4 text-sm"><p>差出人：{PLATFORM_MAIL_FROM}</p><p className="break-all">宛先：{preview.recipient}</p><p>件名：{preview.subject}</p><p className="font-bold">{preview.scheduled_at ? mailTimeLabel(preview.scheduled_at) + '（日本時間）に送信' : '今すぐ送信'}</p><p className="whitespace-pre-wrap break-words border-t pt-4 leading-7">{preview.body}</p>{notice && <p role="alert" className="text-red-700">{notice}</p>}</div>}
    </Modal>
    <Modal open={cancelPreview} title="送信予約を取り消す" onClose={() => { if (!busy) setCancelPreview(false); }} footer={<div className="flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setCancelPreview(false)}>戻る</button><button type="button" className="btn-primary" disabled={busy || mail === null} onClick={() => { if (mail) void operate('cancel', mail); }}>取り消しを確定</button></div>}><p className="text-sm leading-6">送信前の予約を取り消します。すでに送信されたメールは取り消せません。</p>{notice && <p role="alert" className="mt-3 text-sm text-red-700">{notice}</p>}</Modal>
  </div>;
}
