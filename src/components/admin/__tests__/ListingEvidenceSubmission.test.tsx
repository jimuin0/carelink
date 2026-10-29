/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ListingEvidenceSubmission from '../ListingEvidenceSubmission';
import { uploadListingEvidence } from '@/lib/listing-verification-upload';

jest.mock('@/lib/listing-verification-upload', () => ({ uploadListingEvidence: jest.fn() }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const upload = jest.mocked(uploadListingEvidence);
beforeEach(() => {
  upload.mockReset();
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => '33333333-3333-4333-8333-333333333333', configurable: true });
});

test('受付不明時は同じ書類とIDで再確認し、確認できるまで成功と表示しない', async () => {
  upload.mockResolvedValueOnce({ state: 'unknown' }).mockResolvedValueOnce({ state: 'uploaded' });
  render(<ListingEvidenceSubmission facilityId="22222222-2222-4222-8222-222222222222" />);
  fireEvent.change(screen.getByLabelText('書類の種類'), { target: { value: 'lease' } });
  const file = new File(['%PDF-'], 'document.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText(/書類のファイル/), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '書類を提出する' }));
  expect(await screen.findByText(/受付結果を確認できませんでした/)).toBeInTheDocument();
  expect(screen.queryByText(/書類を受け付けました/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('書類の種類')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '受付状況を再確認' }));
  await waitFor(() => expect(screen.getByText(/書類を受け付けました/)).toBeInTheDocument());
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[0][1]).toEqual(upload.mock.calls[1][1]);
});
