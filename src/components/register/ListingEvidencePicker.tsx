'use client';

import { listingEvidenceOptions, listingEvidencePrivacyNotice, listingSupportingEvidenceNotice, type ListingEvidenceType } from '@/lib/listing-verification-evidence';

type Props = {
  type: ListingEvidenceType | '';
  file: File | null;
  onTypeChange: (type: ListingEvidenceType | '') => void;
  onFileChange: (file: File | null) => void;
};

/** ここでは提出を確定しない。権限・ファイル内容の最終確認はサーバーで行う。 */
export default function ListingEvidencePicker({ type, file, onTypeChange, onFileChange }: Props) {
  return (
    <fieldset className="space-y-3">
      <legend className="form-label">店舗を確認できる書類（1点）</legend>
      <p className="text-sm">開設届・営業許可、店舗の賃貸借契約書、公共料金の請求書など。追加の資料をお願いすることがあります。</p>
      <label htmlFor="listing-evidence-type" className="form-label">書類の種類</label>
      <select id="listing-evidence-type" className="form-input" value={type}
        onChange={event => {
          const value = event.target.value;
          onTypeChange(listingEvidenceOptions.find(option => option.value === value)?.value ?? '');
        }}>
        <option value="">選択してください</option>
        {listingEvidenceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <label htmlFor="listing-evidence-file" className="form-label">書類のファイル（PDF・JPEG・PNG、10MBまで）</label>
      <input id="listing-evidence-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        aria-describedby="listing-evidence-privacy listing-evidence-note"
        onChange={event => onFileChange(event.target.files?.[0] ?? null)} />
      {file && <p className="text-sm">選択中：{file.name}</p>}
      <p id="listing-evidence-privacy" className="text-sm">{listingEvidencePrivacyNotice}</p>
      <p id="listing-evidence-note" className="text-sm">{listingSupportingEvidenceNotice}</p>
    </fieldset>
  );
}
