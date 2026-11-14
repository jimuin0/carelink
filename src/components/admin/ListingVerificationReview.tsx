'use client';

import { useState } from 'react';
import { z } from 'zod';
import { listingEvidenceOptions } from '@/lib/listing-verification-evidence';

const identity = z.object({ name:z.string().nullable(),prefecture:z.string().nullable(),city:z.string().nullable(),address:z.string().nullable() }).strict();
const responseSchema = z.object({ identity,documents:z.array(z.object({ id:z.uuid(),document_type:z.string(),created_at:z.string(),
  applicantName:z.string().nullable(),applicantEmail:z.string().nullable() }).strict()).max(20),currentApproval:z.boolean(),
  publicationPending:z.boolean() }).strict();
type Review = z.infer<typeof responseSchema>;
// 承認の後に公開できたかは API が実際の結果を返す。推測で「公開しました」と書かない。
const PUBLICATION_MESSAGES = {
  published:'確認を記録し、店舗を公開しました。',
  already_published:'確認を記録しました。店舗はすでに公開中です。',
  not_ready:'確認を記録しました。店舗名・所在地・曜日ごとの営業時間、キャッチコピー・紹介文の表現、店舗のオーナー登録のどれかが揃っていないため、まだ公開していません。店舗が設定を直して保存した時点か、揃った後に「公開をもう一度試す」を押した時点で公開されます。',
  suspended:'確認を記録しました。店舗が休止中のため公開していません。店舗が再開するときに、店舗の操作で公開できます。',
  blocked:'確認を記録しましたが、公開できませんでした。申込が却下済みか、店舗情報が確認した内容から変わっています。',
  not_pending:'確認を記録しました。公開の状態を確認できなかったため、一覧を読み直してください。',
  unavailable:'確認を記録しました。公開できたかを確認できなかったため、「公開をもう一度試す」を押すか、一覧を読み直してください。',
} as const;
// 「公開をもう一度試す」の結果。
const RETRY_MESSAGES = {
  published:'店舗を公開しました。',
  already_published:'店舗はすでに公開中です。',
  not_ready:'まだ公開できません。店舗名・所在地・曜日ごとの営業時間、キャッチコピー・紹介文の表現、店舗のオーナー登録のどれかが揃っていません。',
  suspended:'店舗が休止中のため公開していません。',
  blocked:'公開できませんでした。申込が却下済みか、店舗情報が確認した内容から変わっています。',
  not_pending:'公開待ちの店舗ではありません。一覧を読み直してください。',
  unavailable:'公開できたかを確認できませんでした。時間をおいてもう一度試してください。',
} as const;
// 公開待ちのまま残り得る結果。運営がやり直せるようにボタンを出す。
const RETRYABLE = new Set(['not_ready','unavailable']);

export default function ListingVerificationReview({ facilityId }: { facilityId:string }) {
  const [review,setReview] = useState<Review | null>(null);
  const [selected,setSelected] = useState<string[]>([]);
  const [documentVerified,setDocumentVerified] = useState(false);
  const [authorityVerified,setAuthorityVerified] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [canRetry,setCanRetry] = useState(false);

  async function load() {
    if (busy) return;
    setBusy(true); setReview(null); setSelected([]); setDocumentVerified(false); setAuthorityVerified(false); setMessage(''); setCanRetry(false);
    try {
      const response=await fetch(`/api/admin/listing-verification?facility_id=${encodeURIComponent(facilityId)}`,{ cache:'no-store' });
      const parsed=responseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('unavailable');
      setReview(parsed.data); setCanRetry(parsed.data.publicationPending);
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
      const publication = (typeof result?.publication === 'string' && Object.hasOwn(PUBLICATION_MESSAGES,result.publication) ? result.publication : 'unavailable') as keyof typeof PUBLICATION_MESSAGES;
      setMessage(PUBLICATION_MESSAGES[publication]); setCanRetry(RETRYABLE.has(publication));
    } catch { setMessage('確認結果を確定できませんでした。情報を読み直してから確認してください。'); }
    finally { setReview(null); setBusy(false); }
  }
  async function retryPublication() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const response=await fetch('/api/admin/listing-verification/publish',{ method:'POST',headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ facilityId }) });
      const result=await response.json().catch(() => null);
      const publication = (result?.state === 'done' && typeof result.publication === 'string' && Object.hasOwn(RETRY_MESSAGES,result.publication) ? result.publication : 'unavailable') as keyof typeof RETRY_MESSAGES;
      setMessage(RETRY_MESSAGES[publication]); setCanRetry(RETRYABLE.has(publication));
    } catch { setMessage(RETRY_MESSAGES.unavailable); setCanRetry(true); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 border-t pt-3 text-sm">
    <button type="button" className="underline" disabled={busy} onClick={() => void load()}>店舗確認書類を読み込む</button>
    {message && <p role="status" className="mt-2">{message}</p>}
    {canRetry && <div className="mt-2">
      {review?.publicationPending && !message && <p className="mb-1">書類は確認済みで、公開を待っています。</p>}
      <button type="button" className="underline" disabled={busy} onClick={() => void retryPublication()}>公開をもう一度試す</button>
    </div>}
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
