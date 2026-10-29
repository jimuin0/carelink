/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent,render,screen } from '@testing-library/react';
import ListingVerificationSearch from '../ListingVerificationSearch';

test('既存の公開店舗を検索して確認画面へ進める',async()=>{
  global.fetch=jest.fn().mockResolvedValue({ ok:true,json:async()=>({ facilities:[{
    id:'22222222-2222-4222-8222-222222222222',name:'合成店舗',prefecture:'大阪府',city:'大阪市',status:'published',
  }],hasMore:false }) });
  render(<ListingVerificationSearch />);
  fireEvent.change(screen.getByLabelText('確認する施設名'),{ target:{ value:'合成店舗' } });
  fireEvent.click(screen.getByRole('button',{ name:'検索' }));
  expect(await screen.findByText('合成店舗')).toBeInTheDocument();
  expect(screen.getByText(/大阪府大阪市.*公開中/)).toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'店舗確認書類を読み込む' })).toBeEnabled();
});
