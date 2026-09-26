import { z } from 'zod';
import { canonicalSalonSubmission } from './salon-submission-contract';
import { salonPhotoPath, SALON_PHOTO_BUCKET } from './salon-photo-contract';
import { readSalonBrowserContext, saveSalonBrowserContext, type SalonBrowserContext } from './salon-browser-context';
import type { SalonFormValues } from './validations';
import { salonFieldErrors, type SalonFieldErrors } from './salon-field-errors';

type Store = Parameters<typeof readSalonBrowserContext>[0];
type Dependencies = {
  store: Store; request: typeof fetch; uuid: () => string;
  captcha: () => Promise<string | null>;
  compress: (file: File) => Promise<File>;
  upload: (bucket: string, path: string, token: string, file: File) => Promise<unknown>;
};
type Result = { state: 'ready' } | { state: 'confirmed'; receiptId: string }
  | { state: 'blocked' | 'unknown'; message: string }
  | { state: 'retryable'; message: string; fieldErrors?: SalonFieldErrors };
type CommitInput = { intentId: string; registration: object; photoIds: string[] };
const uuid = z.uuid();
const uncertain: Result = { state: 'unknown', message: '送信結果を確認できませんでした。同じ申込の受付状況を確認してください。新たな申込として送信しないでください。' };
const blocked: Result = { state: 'blocked', message: 'この申込の確認情報を利用できません。申込時のブラウザーの同じタブで確認するか、お問い合わせください。' };
const retryable: Result = { state: 'retryable', message: '送信の準備が完了していません。入力内容と写真を保持したまま、もう一度お試しください。' };

/** One instance per mounted form. Selection UUIDs survive retry in memory;
 * only the intent selector and phase survive navigation in tab storage.
 * No failure path removes uploaded objects or silently starts a new intent. */
export class SalonRegistrationBrowser {
  private photos = new Map<number, { original: File; compressed: File; selectionId: string }>();
  private pending: CommitInput | null = null;
  private replayVerified = false;
  constructor(private readonly deps: Dependencies) {}

  private async post(path: string, body: unknown) {
    try {
      // Native Window.fetch rejects an arbitrary object as its receiver.
      // Detach injected functions rather than invoking them as deps methods.
      const request = this.deps.request;
      const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      return { status: response.status, ok: response.ok, body: await response.json() };
    } catch { return null; }
  }
  async reconcile(): Promise<Result> {
    this.replayVerified = false;
    const current = readSalonBrowserContext(this.deps.store);
    if (current.state === 'empty') return { state: 'ready' };
    if (current.state !== 'ready') return blocked;
    const result = await this.post('/api/salons/status', { intentId: current.context.intentId });
    if (!result?.ok) return current.context.phase === 'attempted' ? uncertain : blocked;
    if (result.body?.state === 'committed' && uuid.safeParse(result.body.receiptId).success) {
      if (!this.saveCurrent({ ...current.context, phase: 'confirmed' })) return blocked;
      return { state: 'confirmed', receiptId: result.body.receiptId };
    }
    if (result.body?.state === 'uncommitted') {
      this.replayVerified = current.context.phase === 'attempted';
      return current.context.phase === 'prepared' ? { state: 'ready' } : uncertain;
    }
    return blocked;
  }
  private saveCurrent(context: SalonBrowserContext, initialize = false) {
    const current = readSalonBrowserContext(this.deps.store);
    if (current.state === 'unavailable' || (current.state === 'empty' && !initialize)
      || (current.state === 'ready' && current.context.intentId !== context.intentId)) return false;
    return saveSalonBrowserContext(this.deps.store, context);
  }
  private async commit(input: CommitInput): Promise<Result> {
    if (!this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'attempted' })) return blocked;
    const result = await this.post('/api/salons/commit', input);
    if (result?.ok && [200, 201].includes(result.status)
      && ['committed', 'replay'].includes(result.body?.state) && uuid.safeParse(result.body?.receiptId).success) {
      if (!this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'confirmed' })) return blocked;
      return { state: 'confirmed', receiptId: result.body.receiptId };
    }
    if (result?.status === 400 && result.body?.state === 'invalid') {
      this.pending = null;
      if (!this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'prepared' })) return blocked;
      const fields = result.body.fieldErrors;
      const fieldErrors = fields && typeof fields === 'object' && !Array.isArray(fields)
        ? salonFieldErrors(Object.keys(fields).map(field => ({ path: [field] }))) : {};
      return { state: 'retryable', message: '入力内容を確認してください。申込はまだ確定していません。', fieldErrors };
    }
    return uncertain;
  }
  async retryUnknown(): Promise<Result> {
    // Always reconcile before replay. A page reload loses the in-memory body;
    // never reconstruct it from an empty form or silently change the payload.
    const checked = await this.reconcile();
    if (checked.state !== 'unknown' || !this.pending || !this.replayVerified) return checked;
    return this.commit(this.pending);
  }
  async submit(data: SalonFormValues, files: (File | null)[]): Promise<Result> {
    const canonical = canonicalSalonSubmission({ ...data,
      seat_count: Number.isNaN(data.seat_count) ? null : data.seat_count,
      staff_count: Number.isNaN(data.staff_count) ? null : data.staff_count,
      source: 'register', photo_urls: [] });
    if (!canonical || files.length > 7) return { state: 'retryable', message: '入力内容と写真を確認してください。' };
    const checked = await this.reconcile();
    if (checked.state !== 'ready') return checked;
    let current = readSalonBrowserContext(this.deps.store);
    if (current.state === 'empty') {
      let captcha: string | null;
      try { captcha = await this.deps.captcha(); } catch { return retryable; }
      const preparation = await this.post('/api/salons/prepare', captcha ? { recaptcha_token: captcha } : {});
      if (!preparation?.ok || preparation.status !== 201 || preparation.body?.state !== 'prepared'
        || !uuid.safeParse(preparation.body?.intentId).success) return retryable;
      if (!this.saveCurrent({ version: 1, intentId: preparation.body.intentId, phase: 'prepared' }, true)) return blocked;
      current = readSalonBrowserContext(this.deps.store);
    }
    if (current.state !== 'ready') return blocked;
    const intentId = current.context.intentId;
    const results = await Promise.allSettled(files.map(async (file, slot) => {
      if (!file) return null;
      let selection = this.photos.get(slot);
      if (!selection || selection.original !== file) {
        const compressed = await this.deps.compress(file).catch(() => file);
        selection = { original: file, compressed, selectionId: this.deps.uuid() };
        this.photos.set(slot, selection);
      }
      const body = { intentId, selectionId: selection.selectionId, slot,
        mimeType: selection.compressed.type, byteSize: selection.compressed.size };
      const prepared = await this.post('/api/salons/photos', body);
      if (!prepared?.ok || !uuid.safeParse(prepared.body?.photoId).success) throw new Error('Photo preparation unavailable');
      const path = salonPhotoPath(intentId, prepared.body.photoId, body.mimeType);
      if (!path || prepared.body.path !== path) throw new Error('Photo path mismatch');
      if (prepared.body.state === 'uploaded') return prepared.body.photoId as string;
      if (prepared.body.state !== 'upload' || typeof prepared.body.token !== 'string'
        || prepared.body.token.length < 1 || prepared.body.token.length > 8192) throw new Error('Photo capability unavailable');
      // Provider acknowledgement can be lost. Re-read this same manifest and
      // metadata rather than delete, overwrite, or allocate another selection.
      await this.deps.upload(SALON_PHOTO_BUCKET, path, prepared.body.token, selection.compressed).catch(() => null);
      const verified = await this.post('/api/salons/photos', body);
      if (!verified?.ok || verified.body?.state !== 'uploaded' || verified.body.photoId !== prepared.body.photoId
        || verified.body.path !== path) throw new Error('Photo upload unconfirmed');
      return prepared.body.photoId as string;
    }));
    if (results.some(result => result.status === 'rejected')) return retryable;
    const photoIds: string[] = [];
    for (const result of results) if (result.status === 'fulfilled' && result.value) photoIds.push(result.value);
    const { photo_url: _photoUrl, photo_urls: _photoUrls, ...registration } = canonical.row;
    this.pending = { intentId, registration, photoIds };
    return this.commit(this.pending);
  }
}
