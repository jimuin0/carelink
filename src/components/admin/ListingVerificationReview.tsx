'use client';

import { useState } from 'react';
import { z } from 'zod';
import { listingEvidenceOptions } from '@/lib/listing-verification-evidence';

const identity = z.object({ name:z.string().nullable(),prefecture:z.string().nullable(),city:z.string().nullable(),address:z.string().nullable() }).strict();
const responseSchema = z.object({ identity,documents:z.array(z.object({ id:z.uuid(),document_type:z.string(),created_at:z.string(),
  applicantName:z.string().nullable(),applicantEmail:z.string().nullable() }).strict()).max(20),currentApproval:z.boolean() }).strict();
type Review = z.infer<typeof responseSchema>;

export default function ListingVerificationReview({ facilityId }: { facilityId:string }) {
  const [review,setReview] = useState<Review | null>(null);
  const [selected,setSelected] = useState<string[]>([]);
  const [documentVerified,setDocumentVerified] = useState(false);
  const [authorityVerified,setAuthorityVerified] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');

  async function load() {
    if (busy) return;
    setBusy(true); setReview(null); setSelected([]); setDocumentVerified(false); setAuthorityVerified(false); setMessage('');
    try {
      const response=await fetch(`/api/admin/listing-verification?facility_id=${encodeURIComponent(facilityId)}`,{ cache:'no-store' });
      const parsed=responseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('unavailable');
      setReview(parsed.data);
    } catch { setMessage('確認情報を読み込めませんでした。もう一度読み込んでください。'); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!review || busy || !selected.length || !documentVerified || !authorityVerified) return;
    setBusy(true); setMessage('');
    try {
      const response=await fetch('/api/admin/listing-verification/approve',{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ facilityId,documentIds:selected,expectedIdentity:review.identity,documentVerified:true,authorityVerified:true }) });
      const result=await response.json();
      if (!response.ok || result?.state !== 'approved') throw new Error('unavailable');
      setMessage('確認を記録しました。掲載の公開操作は店舗側で行います。');
    } catch { setMessage('確認結果を確定できませんでした。情報を読み直してから確認してください。'); }
    finally { setReview(null); setBusy(false); }
  }

  return <div className="mt-3 border-t pt-3 text-sm">
    <button type="button" className="underline" disabled={busy} onClick={() => void load()}>店舗確認書類を読み込む</button>
    {message && <p role="status" className="mt-2">{message}</p>}
    {review && <div className="mt-3 space-y-3">
      <p>対象：{review.identity.name}　{review.identity.prefecture}{review.identity.city}{review.identity.address}</p>
      <p>{review.currentApproval ? 'この店舗情報の確認記録があります。公開時に提出者の権限も再確認します。' : 'この店舗情報に一致する確認記録はありません。'}</p>
      {review.documents.length === 0 ? <p>提出記録はまだありません。</p> : <fieldset className="space-y-2">
        <legend className="font-bold">確認した書類を選択（１点から）</legend>
        {review.documents.map(document => <div key={document.id}>
          <label><input type="checkbox" disabled={busy} checked={selected.includes(document.id)} onChange={event =>
            setSelected(current => event.target.checked ? [...current,document.id] : current.filter(id => id !== document.id))} />{' '}
            {listingEvidenceOptions.find(option => option.value === document.document_type)?.label ?? '書類'}
          </label>{' '}
          <a className="underline" href={`/api/admin/listing-verification/document?facility_id=${encodeURIComponent(facilityId)}&document_id=${encodeURIComponent(document.id)}`}>書類を開く</a>
          <p className="ml-5 text-gray-600">提出者：{document.applicantName || '確認できません'}{document.applicantEmail ? `（${document.applicantEmail}）` : ''}</p>
        </div>)}
      </fieldset>}
      <p>提出者の氏名・連絡先は自己申告のため、書類や独立した連絡先などを使って管理権限を確認してください。</p>
      <label className="block"><input type="checkbox" checked={documentVerified} disabled={busy} onChange={event => setDocumentVerified(event.target.checked)} /> 書類と店舗情報を照合しました</label>
      <label className="block"><input type="checkbox" checked={authorityVerified} disabled={busy} onChange={event => setAuthorityVerified(event.target.checked)} /> 申請者の管理権限を確認しました</label>
      <button type="button" className="btn-primary" disabled={busy || !selected.length || selected.length > 5 || !documentVerified || !authorityVerified} onClick={() => void approve()}>確認を記録する</button>
    </div>}
  </div>;
}
