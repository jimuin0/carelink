'use client';

import { useState } from 'react';
import { z } from 'zod';
import ListingVerificationReview from './ListingVerificationReview';

const result=z.object({ facilities:z.array(z.object({ id:z.uuid(),name:z.string(),prefecture:z.string().nullable(),
  city:z.string().nullable(),status:z.string().nullable() }).strict()).max(20),hasMore:z.boolean() }).strict();

/** Existing published facilities remain online while the operator reviews them. */
export default function ListingVerificationSearch() {
  const [query,setQuery]=useState('');
  const [data,setData]=useState<z.infer<typeof result> | null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function search(event:React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (query.trim().length<2) { setMessage('施設名を2文字以上入力してください。'); return; }
    setBusy(true); setData(null); setMessage('');
    try {
      const response=await fetch(`/api/admin/listing-verification/facilities?q=${encodeURIComponent(query.trim())}`,{ cache:'no-store' });
      const parsed=result.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('unavailable');
      setData(parsed.data);
    } catch { setMessage('施設を検索できませんでした。もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  return <section className="my-4 rounded-xl border p-4">
    <h2 className="font-bold">既存店舗の確認</h2>
    <p className="my-2 text-sm">公開中の店舗は公開したまま順次確認します。</p>
    <form onSubmit={event => void search(event)} className="flex gap-2">
      <label htmlFor="listing-verification-search" className="sr-only">確認する施設名</label>
      <input id="listing-verification-search" className="form-input" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />
      <button className="btn-outline" disabled={busy} type="submit">検索</button>
    </form>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {data && <div className="mt-3 space-y-3">
      {data.facilities.length===0 && <p>該当する施設はありません。</p>}
      {data.hasMore && <p>20件まで表示しています。施設名を詳しく入力してください。</p>}
      {data.facilities.map(facility => <div key={facility.id} className="rounded border p-3">
        <p className="font-bold">{facility.name}</p>
        <p className="text-sm">{facility.prefecture}{facility.city}　{facility.status === 'published' ? '公開中' : '非公開'}</p>
        <ListingVerificationReview facilityId={facility.id} />
      </div>)}
    </div>}
  </section>;
}
