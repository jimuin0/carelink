import { z } from 'zod';
import type { BookingFormData } from './validations-booking';
export const BOOKING_CREATE_PENDING_PREFIX = 'carelink-booking-create:';
export const BOOKING_CREATE_UNKNOWN = '予約の受付結果を確認できません。同じ受付番号で照合してください。';
const acceptedSchema = z.object({ success: z.literal(true), state: z.literal('accepted'), operationId: z.uuid(), bookingId: z.uuid(),
  bookingStatus: z.enum(['pending','confirmed']), bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/), totalPrice: z.number().int().nonnegative(), notification: z.literal('queued') });
export type BookingAccepted = z.infer<typeof acceptedSchema>;
export type BookingCreateClientResult = { state: 'accepted'; receipt: BookingAccepted } | { state: 'closed'; error?: string } | { state: 'pending'; error: string };
const recordSchema = z.object({ id: z.uuid(), state: z.enum(['pending','accepted']) }).strict();
type RecordData = z.infer<typeof recordSchema>;

/** Only the opaque operation/state persists. Contact details and the frozen request stay in memory. */
export class BookingCreateClient {
  private record: RecordData | null = null;
  private frozen: BookingFormData | null = null;
  private busy = false;
  constructor(private readonly facilityId: string, private readonly storage: Storage,
    private readonly transport: typeof fetch = (...args) => fetch(...args), private readonly uuid: () => string = () => crypto.randomUUID()) {}
  get pending() { return this.record !== null; }
  get operationId() { return this.record?.id ?? null; }
  get accepted() { return this.record?.state === 'accepted'; }
  load() {
    const raw = this.storage.getItem(BOOKING_CREATE_PENDING_PREFIX + this.facilityId);
    if (!raw) return false;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('受付情報を読み取れません。入力内容を保持したまま店舗へ受付状況を確認してください。');
    this.record = { ...parsed.data, id:parsed.data.id.toLowerCase() }; return true;
  }
  private persist(record: RecordData) {
    const key = BOOKING_CREATE_PENDING_PREFIX + this.facilityId;
    const raw = JSON.stringify(record);
    this.storage.setItem(key, raw);
    if (this.storage.getItem(key) !== raw) throw new Error('受付番号を保存できません。ブラウザの保存設定を確認してください。');
    this.record = record;
  }
  private clearClosed() {
    const key = BOOKING_CREATE_PENDING_PREFIX + this.facilityId;
    this.storage.removeItem(key);
    if (this.storage.getItem(key) !== null) throw new Error('終了した受付番号を消去できません。保存設定を確認してください。');
    this.record = null; this.frozen = null;
  }
  /** A new booking after a verified acceptance is an explicit user action. Unknown operations cannot be discarded. */
  newAfterAcceptance() {
    if (this.record?.state !== 'accepted') throw new Error(BOOKING_CREATE_UNKNOWN);
    this.clearClosed();
  }
  private async call(action: string, body?: BookingFormData): Promise<unknown> {
    const response = await this.transport('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Booking-Action': action, 'Idempotency-Key': this.record!.id },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const parsed = await response.json().catch(() => null);
    // Only exact receipt/closed/context responses authorize a state transition; a 200 with broken JSON remains unknown.
    if (response.ok || (parsed?.state === 'closed' && parsed?.operationId === this.record?.id)) return parsed;
    throw new Error(typeof parsed?.error === 'string' ? parsed.error : BOOKING_CREATE_UNKNOWN);
  }
  private interpret(value: unknown): BookingCreateClientResult | null {
    const accepted = acceptedSchema.safeParse(value);
    if (accepted.success && accepted.data.operationId === this.record?.id) {
      this.persist({ id: this.record.id, state: 'accepted' });
      return { state: 'accepted', receipt: accepted.data };
    }
    const closed = z.object({ state: z.literal('closed'), operationId: z.uuid(), error: z.string().optional() }).safeParse(value);
    if (closed.success && closed.data.operationId === this.record?.id) {
      this.clearClosed(); return { state: 'closed', error: closed.data.error };
    }
    return null;
  }
  async submit(body: BookingFormData): Promise<BookingCreateClientResult> {
    if (this.busy) return { state: 'pending', error: BOOKING_CREATE_UNKNOWN };
    this.busy = true;
    try {
      if (!this.record) {
        this.persist({ id: this.uuid().toLowerCase(), state: 'pending' });
        this.frozen = structuredClone(body);
      }
      // Every subsequent submission first reconciles the original key, never current edited fields.
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      const context = locks?.request
        ? await locks.request('carelink-booking-create-context', { mode:'exclusive', signal:AbortSignal.timeout(15000) }, () => this.call('context'))
        : await this.call('context');
      if (!context || typeof context !== 'object' || !('state' in context) || context.state !== 'context_ready') throw new Error(BOOKING_CREATE_UNKNOWN);
      const prior = await this.call('status');
      const resolved = this.interpret(prior); if (resolved) return resolved;
      if (!this.frozen) return { state: 'pending', error: '前の受付が確認中です。受付状況を照合するか、未受付の終了を確認してから内容を入力してください。' };
      const prepared = await this.call('prepare', this.frozen);
      const replayed = this.interpret(prepared); if (replayed) return replayed;
      if (!prepared || typeof prepared !== 'object' || !('state' in prepared) || prepared.state !== 'prepared'
        || !('operationId' in prepared) || prepared.operationId !== this.record?.id) throw new Error(BOOKING_CREATE_UNKNOWN);
      return this.interpret(await this.call('create', this.frozen)) ?? { state: 'pending', error: BOOKING_CREATE_UNKNOWN };
    } catch (error) { return { state: 'pending', error: error instanceof Error ? error.message : BOOKING_CREATE_UNKNOWN }; }
    finally { this.busy = false; }
  }
  async reconcile(close = false): Promise<BookingCreateClientResult> {
    if (this.busy || !this.record) return { state: 'pending', error: BOOKING_CREATE_UNKNOWN };
    this.busy = true;
    try { return this.interpret(await this.call(close ? 'close' : 'status')) ?? { state: 'pending', error: 'この受付はまだ確定していません。同じ受付番号で再度照合してください。' }; }
    catch (error) { return { state: 'pending', error: error instanceof Error ? error.message : BOOKING_CREATE_UNKNOWN }; }
    finally { this.busy = false; }
  }
}
