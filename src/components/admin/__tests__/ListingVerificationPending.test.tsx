/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {fireEvent,render,screen} from '@testing-library/react';
import ListingVerificationPending from '../ListingVerificationPending';

const id='11111111-1111-4111-8111-111111111111';
const response={facilities:[{id,name:'検証店舗',prefecture:'大阪府',city:'豊中市',createdAt:'2026-10-30T01:00:00Z'}],
  next:{id,time:'2026-10-30T01:00:00Z'}};
afterEach(()=>jest.restoreAllMocks());
test('運営が提出済みの店舗を選んで確認でき、次の範囲に進める',async()=>{
  global.fetch=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>response})
    .mockResolvedValueOnce({ok:true,json:async()=>({facilities:[],next:null})});
  render(<ListingVerificationPending/>);
  fireEvent.click(screen.getByRole('button',{name:'一覧を読み込む'}));
  expect(await screen.findByText('検証店舗')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'店舗確認書類を読み込む'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'次の範囲を見る'}));
  expect(await screen.findByText('この範囲に確認待ちの書類はありません。')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining(`id=${id}`),{cache:'no-store'});
});
test('取得障害は空一覧にせず再読み込みできる',async()=>{
  global.fetch=jest.fn().mockResolvedValueOnce({ok:false,json:async()=>({})});
  render(<ListingVerificationPending/>);
  fireEvent.click(screen.getByRole('button',{name:'一覧を読み込む'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('一覧を確認できませんでした');
  expect(screen.getByRole('button',{name:'一覧を読み込む'})).toBeEnabled();
});
