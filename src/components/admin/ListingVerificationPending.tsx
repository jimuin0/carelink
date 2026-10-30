'use client';

import { useState } from 'react';
import { z } from 'zod';
import ListingVerificationReview from './ListingVerificationReview';

const schema=z.object({ facilities:z.array(z.object({ id:z.uuid(),name:z.string(),prefecture:z.string().nullable(),
  city:z.string().nullable(),createdAt:z.string() }).strict()).max(20),
  next:z.object({ time:z.string(),id:z.uuid() }).strict().nullable() }).strict();
type Result=z.infer<typeof schema>;

/** No automatic decisions: each document still requires an operator review. */
export default function ListingVerificationPending() {
  const [data,setData]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function load(cursor:Result['next']) {
    setBusy(true); setError('');
    try {
      const params=new URLSearchParams();
      if (cursor) { params.set('time',cursor.time); params.set('id',cursor.id); }
      const response=await fetch(`/api/admin/listing-verification/pending?${params.toString()}`,{cache:'no-store'});
      const parsed=schema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('unavailable');
      setData(parsed.data);
    } catch { setData(null); setError('一覧を確認できませんでした。もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  return <section className="my-4 rounded-xl border p-4">
    <h2 className="font-bold">提出書類の確認</h2>
    <p className="my-2 text-sm">提出済みの書類から、確認記録に含まれていないものを新しい順に表示します。</p>
    <button className="btn-outline" type="button" disabled={busy} onClick={()=>void load(null)}>一覧を読み込む</button>
    {error && <p role="alert">{error}</p>}
    {data && <div className="mt-3 space-y-3">
      {data.facilities.length===0 && <p>この範囲に確認待ちの書類はありません。</p>}
      {data.facilities.map(item=><div key={item.id} className="rounded border p-3">
        <p className="font-bold">{item.name}</p><p className="text-sm">{item.prefecture}{item.city}</p>
        <ListingVerificationReview facilityId={item.id} />
      </div>)}
      {data.next && <button className="btn-outline" type="button" disabled={busy} onClick={()=>void load(data.next)}>次の範囲を見る</button>}
    </div>}
  </section>;
}
