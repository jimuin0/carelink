import { UUID_REGEX } from './constants';
import { isSalonField, SALON_FIELD_MESSAGES, type SalonFieldErrors } from './salon-field-errors';

export const SALON_SUBMISSION_UNKNOWN = '送信結果を確認できませんでした。登録済みの可能性があります。重複を避けるため再送信せず、お問い合わせから受付状況の確認をお願いします。';

/** 一件が失敗しても全uploadの確定を待ち、cleanupと遅延成功の競合を防ぐ。 */
export async function settleSalonUploads<T>(uploads: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(uploads);
  const values: T[] = [];
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    values.push(result.value);
  }
  return values;
}

type RegistrationResult =
  | { kind: 'confirmed'; id: string }
  | { kind: 'rejected'; message: string; fieldErrors?: SalonFieldErrors }
  | { kind: 'unknown' };

/** 保存前の既知拒否だけを再試行可能とし、proxy/通信/不正成功応答は推測しない。 */
export async function readSalonRegistrationResult(response: Response): Promise<RegistrationResult> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'unknown' };
  const data = body as Record<string, unknown>;
  if (response.ok && data.success === true && typeof data.id === 'string' && UUID_REGEX.test(data.id)) {
    return { kind: 'confirmed', id: data.id };
  }
  if ([400, 403, 429].includes(response.status) && typeof data.error === 'string' && data.error.trim()) {
    if (response.status === 400 && data.fieldErrors && typeof data.fieldErrors === 'object' && !Array.isArray(data.fieldErrors)) {
      const fieldErrors: SalonFieldErrors = {};
      for (const field of Object.keys(data.fieldErrors)) {
        if (isSalonField(field)) fieldErrors[field] = SALON_FIELD_MESSAGES[field];
      }
      if (Object.keys(fieldErrors).length) return { kind: 'rejected', message: data.error, fieldErrors };
    }
    return { kind: 'rejected', message: data.error };
  }
  return { kind: 'unknown' };
}
