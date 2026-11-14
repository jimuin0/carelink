import { z } from 'zod';
import { hasListingEvidenceSignature, listingEvidenceInputSchema, listingEvidencePath } from './listing-verification-evidence';

const ready = z.discriminatedUnion('state', [
  z.object({ state:z.literal('upload'),path:z.string(),token:z.string().min(1).max(8192) }).strict(),
  z.object({ state:z.literal('uploaded') }).strict(),
]);
type Dependencies = {
  request: (url:string,init:RequestInit)=>Promise<Response>;
  upload: (path:string,token:string,file:File)=>Promise<{ error:unknown }>;
  sha256: (bytes:Uint8Array)=>Promise<string>;
};

/** The caller retains the same document ID and file across uncertain retries. */
export async function uploadListingEvidence(deps:Dependencies, value:{ facilityId:string;documentId:string;type:string;file:File }) {
  if (!z.uuid().safeParse(value.facilityId).success || !z.uuid().safeParse(value.documentId).success) return { state:'invalid' as const };
  const metadata=listingEvidenceInputSchema.safeParse({ type:value.type,mimeType:value.file.type,byteSize:value.file.size });
  if (!metadata.success) return { state:'invalid' as const };
  try {
    const bytes=new Uint8Array(await value.file.arrayBuffer());
    if (bytes.length !== value.file.size || !hasListingEvidenceSignature(bytes,value.file.type)) return { state:'invalid' as const };
    const digest=await deps.sha256(bytes);
    if (!/^[a-f0-9]{64}$/.test(digest)) return { state:'unavailable' as const };
    const expectedPath=listingEvidencePath(value.facilityId,value.documentId,value.file.type);
    if (!expectedPath) return { state:'invalid' as const };
    const url=`/api/admin/listing-verification/documents/prepare?facility_id=${encodeURIComponent(value.facilityId)}`;
    const payload=JSON.stringify({ ...metadata.data,documentId:value.documentId,sha256:digest });
    const prepare=async()=>{
      const response=await deps.request(url,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:payload });
      if (!response.ok) return null;
      const result=ready.safeParse(await response.json());
      return result.success ? result.data : null;
    };
    const prepared=await prepare();
    if (!prepared) return { state:'unknown' as const };
    if (prepared.state === 'uploaded') return { state:'uploaded' as const };
    if (prepared.path !== expectedPath) return { state:'unknown' as const };
    // A lost response is reconciled using the same manifest, never a new ID.
    try { await deps.upload(expectedPath,prepared.token,value.file); } catch { /* reconcile below */ }
    const confirmed=await prepare();
    return confirmed?.state === 'uploaded' ? { state:'uploaded' as const } : { state:'unknown' as const };
  } catch {
    return { state:'unknown' as const };
  }
}
