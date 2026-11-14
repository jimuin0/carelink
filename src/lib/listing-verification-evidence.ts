/** 資料の種類は受付候補であり、提出自体を実在・管理権限の証明とみなさない。 */
export const listingEvidenceOptions = [
  { value: 'opening_certificate', label: '開設届・営業許可・検査確認済証など' },
  { value: 'lease', label: '店舗の賃貸借契約書・使用契約書' },
  { value: 'utility_bill', label: '店舗宛ての公共料金の請求書・領収書' },
  { value: 'government_document', label: '店舗名・住所が分かる官公庁からの通知・証明書' },
  { value: 'business_insurance', label: '店舗名・住所が分かる事業用保険の証券' },
  { value: 'commercial_facility', label: '商業施設との出店・入居契約書' },
  { value: 'other', label: 'その他、店舗名・住所・運営者を確認できる書類' },
] as const;

export type ListingEvidenceType = typeof listingEvidenceOptions[number]['value'];

export const LISTING_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const listingEvidenceInputSchema = z.object({
  type: z.enum(listingEvidenceOptions.map(option => option.value) as [ListingEvidenceType, ...ListingEvidenceType[]]),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  byteSize: z.number().int().positive().max(LISTING_EVIDENCE_MAX_BYTES),
}).strict();

/** 保存先は非公開バケット専用。利用者が選んだファイル名はパスに含めない。 */
export function listingEvidencePath(facilityId: string, evidenceId: string, mimeType: string): string | null {
  const id = z.uuid();
  if (!id.safeParse(facilityId).success || !id.safeParse(evidenceId).success) return null;
  const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
  const extension = Object.hasOwn(extensions, mimeType) ? extensions[mimeType] : undefined;
  if (!extension) return null;
  return `facilities/${facilityId.toLowerCase()}/${evidenceId.toLowerCase()}.${extension}`;
}

/** ファイル形式の一次確認。内容の安全性・書類の真正性は保証しない。 */
export function hasListingEvidenceSignature(bytes: Uint8Array, mimeType: string): boolean {
  const signatures: Record<string, readonly number[]> = {
    'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/jpeg': [0xff, 0xd8, 0xff],
  };
  const expected = Object.hasOwn(signatures, mimeType) ? signatures[mimeType] : undefined;
  return !!expected && bytes.length >= expected.length && expected.every((byte, index) => bytes[index] === byte);
}

/** 提出書類の補足に用いるもの。これだけでは承認しない。 */
export const listingSupportingEvidenceNotice = '他サイトの掲載URLは参考資料です。店舗の確認書類と、申請者が管理できる権限の確認が必要です。';

export const listingEvidencePrivacyNotice = '店舗名・所在地・契約者など確認に必要な部分を残し、金額・口座番号・マイナンバーなど不要な部分は隠してください。';
import { z } from 'zod';
