import { z } from 'zod';
import { canonicalSalonSubmission } from './salon-submission-contract';
import { salonPhotoPath, SALON_PHOTO_BUCKET } from './salon-photo-contract';
import { readSalonBrowserContext, saveSalonBrowserContext, type SalonBrowserContext, SALON_BROWSER_CONTEXT_KEY } from './salon-browser-context';
import type { SalonFormValues } from './validations';
import { isSalonField, SALON_FIELD_MESSAGES, SALON_PR_TEXT_PROHIBITED_MESSAGE, type SalonFieldErrors } from './salon-field-errors';
import { salonStorageLimitsSchema, type SalonStorageLimits } from './salon-storage-limits';
import { registrationConsentSchema, REGISTRATION_CONSENT_REQUIRED, type RegistrationConsent } from './registration-consent';
import { formatMegabytes } from './format-megabytes';

type Store = Parameters<typeof readSalonBrowserContext>[0];
// 店舗の申込入口は /register だけ（2026年10月23日 神原さん決定・/recruit は /register へ 308 転送）。
// 以前は /recruit の別フォームが、別の source 値と別のタブ内キーで同じクラスを使っていた。
type Dependencies = {
  store: Store; request: typeof fetch; uuid: () => string;
  captcha: () => Promise<string | null>;
  compress: (file: File) => Promise<File>;
  upload: (bucket: string, path: string, token: string, file: File) => Promise<unknown>;
};
type Result = { state: 'ready' } | { state: 'confirmed'; receiptId: string }
  | { state: 'blocked' | 'unknown'; message: string }
  | { state: 'retryable'; message: string; fieldErrors?: SalonFieldErrors };
type CommitInput = { intentId: string; registration: object; photoIds: string[]; consent: RegistrationConsent; publicationHours: SalonFormValues['publication_hours'] };
const uuid = z.uuid();
const uncertain: Result = { state: 'unknown', message: '送信結果を確認できませんでした。同じ申込の受付状況を確認してください。新たな申込として送信しないでください。' };
const blocked: Result = { state: 'blocked', message: 'この申込の確認情報を利用できません。申込時のブラウザーの同じタブで確認するか、お問い合わせください。' };
const retryable: Result = { state: 'retryable', message: '送信の準備が完了していません。入力内容と写真を保持したまま、もう一度お試しください。' };
const PR_TEXT_REJECTED_MESSAGE = 'PR文に掲載できない表現が含まれています。PR文を修正して、もう一度送信してください。';
const FIELDS_REJECTED_MESSAGE = '入力内容に確認が必要な項目があります。表示された欄を修正して、もう一度送信してください。';

/** The server's fixed validation refusal of this body, and nothing else: every
 * entry must be a known form field carrying the exact fixed public message the
 * server uses for it (SALON_FIELD_MESSAGES, or the PR-text content-policy
 * message). Echoed input, unknown keys or an empty object are not proof that
 * the server refused this body before any write. */
function definitiveFieldErrors(body: unknown): SalonFieldErrors | null {
  if (typeof body !== 'object' || body === null) return null;
  const { state, fieldErrors } = body as { state?: unknown; fieldErrors?: unknown };
  if (state !== 'invalid' || typeof fieldErrors !== 'object' || fieldErrors === null || Array.isArray(fieldErrors)) return null;
  const entries = Object.entries(fieldErrors);
  if (entries.length === 0) return null;
  const errors: SalonFieldErrors = {};
  for (const [field, message] of entries) {
    if (!isSalonField(field)) return null;
    if (message !== SALON_FIELD_MESSAGES[field]
      && !(field === 'pr_text' && message === SALON_PR_TEXT_PROHIBITED_MESSAGE)) return null;
    errors[field] = message;
  }
  return errors;
}

/** One instance per mounted form. Selection UUIDs survive retry in memory;
 * only the intent selector and phase survive navigation in tab storage.
 * No failure path removes uploaded objects or silently starts a new intent. */
export class SalonRegistrationBrowser {
  private photos = new Map<number, { original: File; compressed: File; selectionId: string }>();
  private pending: CommitInput | null = null;
  private replayVerified = false;
  private photoLimits: SalonStorageLimits | null = null;
  private commitAttempted = false;
  private createdIntentId: string | null = null;
  private policyRejectedIntentId: string | null = null;
  private readonly contextKey = SALON_BROWSER_CONTEXT_KEY;
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
    const current = readSalonBrowserContext(this.deps.store, this.contextKey);
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
    const current = readSalonBrowserContext(this.deps.store, this.contextKey);
    if (current.state === 'unavailable' || (current.state === 'empty' && !initialize)
      || (current.state === 'ready' && current.context.intentId !== context.intentId)) return false;
    return saveSalonBrowserContext(this.deps.store, context, this.contextKey);
  }
  private async commit(input: CommitInput): Promise<Result> {
    if (!this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'attempted' })) return blocked;
    this.commitAttempted = true;
    const result = await this.post('/api/salons/commit', input);
    if (result?.ok && [200, 201].includes(result.status)
      && ['committed', 'replay'].includes(result.body?.state) && uuid.safeParse(result.body?.receiptId).success) {
      if (!this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'confirmed' })) return blocked;
      return { state: 'confirmed', receiptId: result.body.receiptId };
    }
    if (result?.status === 400) {
      // A validation/consent rejection describes this attempt, not an earlier
      // commit whose reply was lost. Do not reopen the attempted-input fence,
      // with the one exception below.
      const latest = readSalonBrowserContext(this.deps.store, this.contextKey);
      if (latest.state !== 'ready' || latest.context.intentId !== input.intentId) return blocked;
      const checked = await this.reconcile();
      if (checked.state === 'confirmed') return checked;
      if (checked.state === 'ready' || checked.state === 'blocked') return blocked;
      // A field validation refusal (the fixed per-field messages, including the
      // PR-text content policy) is decided by the server from this body alone,
      // before any write, and the status read after it says the intent is still
      // uncommitted. Resending the same body can only be refused again (a tab
      // opened before a deploy, or a newly banned term, would otherwise be stuck
      // for good), so the applicant may fix the named fields for this same
      // intent. An earlier body committing concurrently stays fenced by the
      // intent's payload HMAC: a revised body then gets a conflict, which
      // reconciles to that original receipt. Without verifiable field errors
      // (bare 'invalid', consent_required, echoed input) the outcome stays unknown.
      const fieldErrors = definitiveFieldErrors(result.body);
      if (this.replayVerified && fieldErrors
        && this.saveCurrent({ version: 1, intentId: input.intentId, phase: 'prepared' })) {
        this.commitAttempted = false; this.pending = null; this.replayVerified = false;
        this.policyRejectedIntentId = input.intentId;
        const prTextOnly = Object.keys(fieldErrors).length === 1 && fieldErrors.pr_text === SALON_PR_TEXT_PROHIBITED_MESSAGE;
        return { state: 'retryable', message: prTextOnly ? PR_TEXT_REJECTED_MESSAGE : FIELDS_REJECTED_MESSAGE, fieldErrors };
      }
      return uncertain;
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
  /** This is an in-memory transport fact, not a server receipt or authority.
   * A commit400, lost commit reply or a restored historical selector never
   * grants permission to replace a fenced input snapshot, except the verified
   * field validation refusal handled in commit() for that same intent. */
  canReviseUnsubmittedInput(): boolean {
    if (this.commitAttempted) return false;
    const current = readSalonBrowserContext(this.deps.store, this.contextKey);
    return current.state === 'empty' || (current.state === 'ready' && current.context.phase === 'prepared'
      && (current.context.intentId === this.createdIntentId || current.context.intentId === this.policyRejectedIntentId));
  }
  async submit(data: SalonFormValues, files: (File | null)[], consent?: unknown): Promise<Result> {
    if (this.commitAttempted) {
      const current = await this.reconcile();
      return current.state === 'confirmed' || current.state === 'blocked' ? current : uncertain;
    }
    const agreement = registrationConsentSchema.safeParse(consent);
    if (!agreement.success) return { state: 'retryable', message: REGISTRATION_CONSENT_REQUIRED };
    const canonical = canonicalSalonSubmission({ ...data,
      seat_count: Number.isNaN(data.seat_count) ? null : data.seat_count,
      staff_count: Number.isNaN(data.staff_count) ? null : data.staff_count,
      source: 'register', photo_urls: [] });
    if (!canonical || files.length > 7) return { state: 'retryable', message: '入力内容と写真を確認してください。' };
    const checked = await this.reconcile();
    if (checked.state !== 'ready') return checked;
    let current = readSalonBrowserContext(this.deps.store, this.contextKey);
    if (current.state === 'empty') {
      let captcha: string | null;
      try { captcha = await this.deps.captcha(); } catch { return retryable; }
      const preparation = await this.post('/api/salons/prepare', captcha ? { recaptcha_token: captcha } : {});
      if (!preparation?.ok || preparation.status !== 201 || preparation.body?.state !== 'prepared'
        || !uuid.safeParse(preparation.body?.intentId).success) return retryable;
      if (!this.saveCurrent({ version: 1, intentId: preparation.body.intentId, phase: 'prepared' }, true)) return blocked;
      this.createdIntentId = preparation.body.intentId;
      const limits = salonStorageLimitsSchema.safeParse(preparation.body.photoLimits);
      if (preparation.body.consumerVersion !== 2 || !limits.success) return retryable;
      this.photoLimits = limits.data;
      current = readSalonBrowserContext(this.deps.store, this.contextKey);
    }
    if (current.state !== 'ready') return blocked;
    const intentId = current.context.intentId;
    if (!this.photoLimits) {
      const refreshed = await this.post('/api/salons/prepare', { intentId });
      const limits = salonStorageLimitsSchema.safeParse(refreshed?.body?.photoLimits);
      if (!refreshed?.ok || refreshed.status !== 200 || refreshed.body?.state !== 'prepared'
        || refreshed.body?.intentId !== intentId || refreshed.body?.consumerVersion !== 2 || !limits.success) return retryable;
      const latest = readSalonBrowserContext(this.deps.store, this.contextKey);
      if (latest.state !== 'ready' || latest.context.intentId !== intentId || latest.context.phase !== 'prepared') return blocked;
      this.photoLimits = limits.data;
    }
    const photoLimits = this.photoLimits;
    let outsideLimits = false;
    const results = await Promise.allSettled(files.map(async (file, slot) => {
      if (!file) return null;
      let selection = this.photos.get(slot);
      if (!selection || selection.original !== file) {
        const candidate = await this.deps.compress(file).catch(() => file);
        // Compression may change PNG/GIF to JPEG. A narrower provider MIME
        // policy must not make an otherwise accepted original impossible to
        // upload, nor cause us to relax that policy.
        const compressed = candidate.size <= photoLimits.maxBytes
          && photoLimits.mimeTypes.includes(candidate.type as SalonStorageLimits['mimeTypes'][number]) ? candidate : file;
        selection = { original: file, compressed, selectionId: this.deps.uuid() };
        this.photos.set(slot, selection);
      }
      if (selection.compressed.size > photoLimits.maxBytes || !photoLimits.mimeTypes.includes(selection.compressed.type as SalonStorageLimits['mimeTypes'][number])) {
        outsideLimits = true;
        throw new Error('Photo outside current Storage restrictions');
      }
      const body = { intentId, selectionId: selection.selectionId, slot,
        mimeType: selection.compressed.type, byteSize: selection.compressed.size };
      const prepared = await this.post('/api/salons/photos', body);
      if (prepared?.status === 400 && prepared.body?.state === 'invalid') this.photoLimits = null;
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
    if (outsideLimits) return { state: 'retryable', message: `現在の写真の上限は${formatMegabytes(photoLimits.maxBytes)}、対応形式は${photoLimits.mimeTypes.map(type => type.replace('image/', '')).join('・')}です。元の写真は保持されています。` };
    if (results.some(result => result.status === 'rejected')) return retryable;
    const photoIds: string[] = [];
    for (const result of results) if (result.status === 'fulfilled' && result.value) photoIds.push(result.value);
    const { photo_url: _photoUrl, photo_urls: _photoUrls, ...registration } = canonical.row;
    this.pending = { intentId, registration, photoIds, consent: agreement.data, publicationHours: data.publication_hours };
    return this.commit(this.pending);
  }
}
