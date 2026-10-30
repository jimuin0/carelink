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
      <legend className="form-label">店舗を確認できる書類を１点ご提出ください</legend>
      <p className="text-sm">開設届出済証、検査確認済証、店舗の契約書などが使えます。内容を確認できない場合や、申請者と運営者が異なる場合は、追加資料をお願いすることがあります。</p>
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
