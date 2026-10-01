'use client';

import { useEffect, useRef, useState } from 'react';
import { duplicateLinkInput, duplicateLinkResponse, type DuplicateLinkPreview } from '@/lib/registration-duplicate-contract';

export default function RegistrationDuplicateLink() {
  const [duplicateId, setDuplicateId] = useState('');
  const [canonicalId, setCanonicalId] = useState('');
  const [preview, setPreview] = useState<DuplicateLinkPreview | null>(null);
  const [sameSite, setSameSite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  const reset = () => { setPreview(null); setSameSite(false); setMessage(''); setFacilityId(null); };
  const submit = async (commit: boolean) => {
    if (active.current || (commit && (!preview || !sameSite))) return;
    const input = duplicateLinkInput.safeParse(commit
      ? { action: 'link', duplicateId, canonicalId, duplicateRevision: preview!.duplicateRevision,
        canonicalRevision: preview!.canonicalRevision, sameSite }
      : { action: 'preview', duplicateId, canonicalId });
    if (!input.success) { reset(); setMessage('異なる2件の受付番号（UUID）を入力してください。'); return; }
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    setBusy(true); setMessage(''); setFacilityId(null);
    try {
      const response = await fetch('/api/admin/registrations/duplicate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data), signal: controller.signal });
      const result = duplicateLinkResponse.safeParse(await response.json());
      if (!mounted.current) return;
      reset();
      if (!result.success || response.status >= 500) {
        setMessage(commit ? '結果が不明です。新たに申込・施設を作らず、比較を再取得して記録を確認してください。' : '比較・記録を取得できません。再取得してください。'); return;
      }
      if (!response.ok) { setMessage('関連付けは拒否されました。権限・原申込・現在の店舗情報を確認し、比較を再取得してください。'); return; }
      if (result.data.outcome === 'preview' && !commit
        && result.data.duplicateId === duplicateId && result.data.canonicalId === canonicalId) {
        setPreview(result.data);
      } else if (result.data.outcome === 'linked' || result.data.outcome === 'replay') {
        setFacilityId(result.data.facilityId); setMessage('関連付け記録を確認しました。元申込・写真は保持し、新店舗・通知・公開は作成していません。');
      } else setMessage('結果を確認できません。比較を再取得してください。');
    } catch {
      if (mounted.current) { reset(); setMessage('結果が不明です。新たに申込・施設を作らず、比較を再取得して記録を確認してください。'); }
    } finally {
      clearTimeout(timer); active.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return <section aria-label="重複申込の関連付け" className="bg-white rounded-xl p-4 mb-6 space-y-3">
    <h2 className="font-bold">同一店舗の重複受付を関連付け</h2>
    <p className="text-sm">元申込を消さず、未取り込みの受付を作成済みの店舗へ関連付けます。別支店・別施設の統合、写真移動、所有者変更は行いません。</p>
    <fieldset disabled={busy} className="space-y-2">
      <label className="block">未取り込みの受付番号<input aria-label="未取り込みの受付番号" value={duplicateId} maxLength={36} onChange={event => { reset(); setDuplicateId(event.target.value); }} className="form-input" /></label>
      <label className="block">店舗作成済みの受付番号<input aria-label="店舗作成済みの受付番号" value={canonicalId} maxLength={36} onChange={event => { reset(); setCanonicalId(event.target.value); }} className="form-input" /></label>
      <button type="button" onClick={() => void submit(false)} className="btn-secondary">比較・記録を確認する</button>
      {preview && <div className="space-y-2">
        <p>{preview.name}／{preview.businessType}</p>
        <p>{preview.prefecture} {preview.city} {preview.address} {preview.building}</p>
        <p className="text-sm">2件の原申込と現在の店舗情報・確認済み所有者の一致を確認しました。同名・同住所でも別店舗ではないか確認してください。</p>
        <label><input type="checkbox" checked={sameSite} onChange={event => setSameSite(event.target.checked)} />同じ実店舗の重複申込であり、別支店ではありません</label>
        <button type="button" disabled={!sameSite} onClick={() => void submit(true)} className="btn-primary">元申込を保持して関連付ける</button>
      </div>}
    </fieldset>
    {message && <p role="status">{message}</p>}
    {facilityId && <p className="text-xs break-all">関連付け先の店舗ID：{facilityId}（店舗管理画面への所属権限を付与する操作ではありません）</p>}
  </section>;
}
