/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ListingEvidencePicker from '@/components/register/ListingEvidencePicker';
import type { ListingEvidenceType } from '@/lib/listing-verification-evidence';

function Example() {
  const [type, setType] = useState<ListingEvidenceType | ''>('');
  const [file, setFile] = useState<File | null>(null);
  return <ListingEvidencePicker type={type} file={file} onTypeChange={setType} onFileChange={setFile} />;
}

test('複数の書類から選び、確認に必要な情報と不要な情報の案内を読める', () => {
  render(<Example />);
  expect(screen.getByRole('group', { name: '店舗を確認できる書類を１点ご提出ください' })).toBeInTheDocument();
  expect(screen.getByText(/追加資料をお願いすることがあります/)).toBeInTheDocument();
  const type = screen.getByLabelText('書類の種類');
  fireEvent.change(type, { target: { value: 'utility_bill' } });
  expect(type).toHaveValue('utility_bill');
  const file = new File(['synthetic'], 'fixture.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(/書類のファイル/), { target: { files: [file] } });
  expect(screen.getByText('選択中：fixture.pdf')).toBeInTheDocument();
  expect(screen.getByText(/マイナンバー/)).toBeInTheDocument();
  expect(screen.getByText(/他サイトの掲載URLは参考資料/)).toBeInTheDocument();
});
