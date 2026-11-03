/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ListingVerificationReview from '../ListingVerificationReview';

const facility='22222222-2222-4222-8222-222222222222';
const document='33333333-3333-4333-8333-333333333333';
const identity={ name:'合成店舗',prefecture:'大阪府',city:'大阪市',address:'合成1' };

test('書類と権限の確認を個別に行い、表示中の店舗情報を添えて記録する',async()=>{
  const fetchMock=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[{ id:document,document_type:'lease',created_at:'2026-01-01',applicantName:'合成担当',applicantEmail:'synthetic@example.invalid' }],currentApproval:false,publicationPending:false }) })
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

// 独立レビュー（2026-11-03）：承認の後に公開できたかは API の実際の結果で書く（推測で「公開しました」と書かない）。
test.each([
  ['published','確認を記録し、店舗を公開しました。'],
  ['not_ready','まだ公開していません。店舗が設定を直して保存した時点か、揃った後に「公開をもう一度試す」を押した時点で公開されます。'],
  ['suspended','店舗が休止中のため公開していません。'],
  ['already_published','店舗はすでに公開中です。'],
  ['blocked','公開できませんでした。申込が却下済みか、店舗情報が確認した内容から変わっています。'],
  ['not_pending','公開の状態を確認できなかったため、一覧を読み直してください。'],
  ['unavailable','公開できたかを確認できなかったため、「公開をもう一度試す」を押すか、一覧を読み直してください。'],
  [undefined,'公開できたかを確認できなかったため、「公開をもう一度試す」を押すか、一覧を読み直してください。'],
  ['toString','公開できたかを確認できなかったため、「公開をもう一度試す」を押すか、一覧を読み直してください。'],
])('承認後の表示は公開の結果 %s に合わせる',async(publication,text)=>{
  global.fetch=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[{ id:document,document_type:'lease',created_at:'2026-01-01',applicantName:null,applicantEmail:null }],currentApproval:false,publicationPending:false }) })
    .mockResolvedValueOnce({ ok:true,json:async()=>({ state:'approved',publication }) });
  render(<ListingVerificationReview facilityId={facility} />);
  fireEvent.click(screen.getByRole('button',{ name:'店舗確認書類を読み込む' }));
  fireEvent.click(await screen.findByLabelText('店舗の賃貸借契約書・使用契約書'));
  fireEvent.click(screen.getByLabelText('書類と店舗情報を照合しました'));
  fireEvent.click(screen.getByLabelText('申請者の管理権限を確認しました'));
  fireEvent.click(screen.getByRole('button',{ name:'確認を記録する' }));
  expect(await screen.findByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))).toBeInTheDocument();
  if (publication !== 'published') expect(screen.queryByText(/店舗を公開しました/)).toBeNull();
  // 公開待ちのまま残る結果だけ、やり直しのボタンを出す。
  expect(screen.queryByRole('button',{ name:'公開をもう一度試す' }) !== null).toBe(publication === 'not_ready' || publication === 'unavailable' || publication === undefined || publication === 'toString');
});

// 承認直後の公開が一時的な障害で失敗しても、運営がやり直せる（独立レビュー 2026-11-03）。
test('公開待ちの店舗は、読み込んだ時点でやり直しのボタンを出し、結果を表示する',async()=>{
  const fetchMock=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[],currentApproval:true,publicationPending:true }) })
    .mockResolvedValueOnce({ ok:false,json:async()=>({ state:'done',publication:'unavailable' }) })
    .mockResolvedValueOnce({ ok:true,json:async()=>({ state:'done',publication:'published' }) });
  global.fetch=fetchMock;
  render(<ListingVerificationReview facilityId={facility} />);
  fireEvent.click(screen.getByRole('button',{ name:'店舗確認書類を読み込む' }));
  expect(await screen.findByText('書類は確認済みで、公開を待っています。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{ name:'公開をもう一度試す' }));
  expect(await screen.findByText('公開できたかを確認できませんでした。時間をおいてもう一度試してください。')).toBeInTheDocument();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/listing-verification/publish');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ facilityId:facility });
  fireEvent.click(screen.getByRole('button',{ name:'公開をもう一度試す' }));
  expect(await screen.findByText('店舗を公開しました。')).toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'公開をもう一度試す' })).toBeNull();
});
test.each([
  ['blocked','公開できませんでした。申込が却下済みか、店舗情報が確認した内容から変わっています。',false],
  ['not_ready','まだ公開できません。',true],
  ['already_published','店舗はすでに公開中です。',false],
  ['suspended','店舗が休止中のため公開していません。',false],
  ['not_pending','公開待ちの店舗ではありません。一覧を読み直してください。',false],
  ['other','公開できたかを確認できませんでした。',true],
])('やり直しの結果 %s を表示する',async(publication,text,retryable)=>{
  global.fetch=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[],currentApproval:true,publicationPending:true }) })
    .mockResolvedValueOnce({ ok:true,json:async()=>({ state:'done',publication }) });
  render(<ListingVerificationReview facilityId={facility} />);
  fireEvent.click(screen.getByRole('button',{ name:'店舗確認書類を読み込む' }));
  fireEvent.click(await screen.findByRole('button',{ name:'公開をもう一度試す' }));
  expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'公開をもう一度試す' }) !== null).toBe(retryable);
});
test('やり直しの通信に失敗したら、もう一度押せるまま知らせる',async()=>{
  global.fetch=jest.fn().mockResolvedValueOnce({ ok:true,json:async()=>({ identity,documents:[],currentApproval:true,publicationPending:true }) })
    .mockRejectedValueOnce(new Error('offline'));
  render(<ListingVerificationReview facilityId={facility} />);
  fireEvent.click(screen.getByRole('button',{ name:'店舗確認書類を読み込む' }));
  fireEvent.click(await screen.findByRole('button',{ name:'公開をもう一度試す' }));
  expect(await screen.findByText('公開できたかを確認できませんでした。時間をおいてもう一度試してください。')).toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'公開をもう一度試す' })).toBeEnabled();
});
