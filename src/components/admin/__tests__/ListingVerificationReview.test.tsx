/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ListingVerificationReview from '../ListingVerificationReview';

const facility='22222222-2222-4222-8222-222222222222';
const document='33333333-3333-4333-8333-333333333333';
const identity={ name:'合成店舗',prefecture:'大阪府',city:'大阪市',address:'合成1' };

test('書類と権限の確認を個別に行い、表示中の店舗情報を添えて記録する',async()=>{
  const fetchMock=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[{ id:document,document_type:'lease',created_at:'2026-01-01',applicantName:'合成担当',applicantEmail:'synthetic@example.invalid' }],currentApproval:false }) })
    .mockResolvedValueOnce({ ok:true,json:async()=>({ state:'approved' }) });
  global.fetch=fetchMock;
  render(<ListingVerificationReview facilityId={facility} />);
  fireEvent.click(screen.getByRole('button',{ name:'店舗確認書類を読み込む' }));
  expect(await screen.findByText(/合成店舗/)).toBeInTheDocument();
  expect(screen.getByText(/合成担当/)).toBeInTheDocument();
  const approve=screen.getByRole('button',{ name:'確認を記録する' });
  fireEvent.click(screen.getByLabelText('店舗の賃貸借契約書・使用契約書'));
  fireEvent.click(screen.getByLabelText('書類と店舗情報を照合しました'));
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText('申請者の管理権限を確認しました'));
  fireEvent.click(approve);
  expect(await screen.findByText(/確認を記録しました/)).toBeInTheDocument();
  const body=JSON.parse(fetchMock.mock.calls[1][1].body as string);
  expect(body).toEqual({ facilityId:facility,documentIds:[document],expectedIdentity:identity,documentVerified:true,authorityVerified:true });
});
