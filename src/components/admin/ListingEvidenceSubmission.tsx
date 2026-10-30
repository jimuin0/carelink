'use client';

import { useState } from 'react';
import ListingEvidencePicker from '@/components/register/ListingEvidencePicker';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { uploadListingEvidence } from '@/lib/listing-verification-upload';
import type { ListingEvidenceType } from '@/lib/listing-verification-evidence';

/** The selected file and ID remain fixed while a potentially completed upload is reconciled. */
export default function ListingEvidenceSubmission({ facilityId }: { facilityId: string }) {
  const [type, setType] = useState<ListingEvidenceType | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [attempt, setAttempt] = useState<{ id: string; type: ListingEvidenceType; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pickerVersion, setPickerVersion] = useState(0);

  async function submit() {
    if (busy || (!attempt && (!type || !file))) return;
    const current = attempt ?? (type && file ? { id: crypto.randomUUID(), type, file } : null);
    if (!current) return;
    setAttempt(current);
    setBusy(true);
    setMessage('');
    const result = await uploadListingEvidence({
      request: (url, init) => fetch(url, init),
      upload: (path, token, evidence) => createBrowserSupabaseClient().storage
        .from('listing-verification').uploadToSignedUrl(path, token, evidence, { contentType: evidence.type }),
      sha256: async bytes => {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
        return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      },
    }, { facilityId, documentId: current.id, type: current.type, file: current.file });
    if (result.state === 'uploaded') {
      setMessage('書類を受け付けました。運営が内容と管理権限を確認します。');
      setAttempt(null); setFile(null); setType(''); setPickerVersion(version => version + 1);
    } else if (result.state === 'invalid') {
      setMessage('ファイルの形式またはサイズを確認してください。');
      setAttempt(null);
    } else {
      setMessage('受付結果を確認できませんでした。同じ書類のまま「受付状況を再確認」を押してください。');
    }
    setBusy(false);
  }

  return <section className="my-6 rounded-xl border border-gray-200 p-4" onChange={event => event.stopPropagation()}>
    <h2 className="mb-3 text-lg font-bold">店舗確認書類の提出</h2>
    <p className="mb-3 text-sm">新しい店舗を公開する前に、運営が書類と管理権限を確認します。</p>
    <fieldset disabled={busy || !!attempt}>
      <ListingEvidencePicker key={pickerVersion} type={type} file={file} onTypeChange={setType} onFileChange={setFile} />
    </fieldset>
    <button type="button" className="btn-primary mt-4" disabled={busy || (!attempt && (!type || !file))} onClick={() => void submit()}>
      {busy ? '確認中…' : attempt ? '受付状況を再確認' : '書類を提出する'}
    </button>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
