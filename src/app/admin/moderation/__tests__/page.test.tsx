/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ModerationPage from '../page';
const id = '11111111-1111-4111-8111-111111111111';
const mockFetch = jest.fn(); const mockDb = jest.fn(); const mutation=jest.fn();
const snapshot={id,content_id:id,content_type:'review',report_reason:'Synthetic report',auto_flags:['user_report'],status:'pending',reviewed_at:null,content_hash:'a'.repeat(64),review:{flag_reason:'Synthetic flag',comment:'Original content for moderation',rating:4,photo_urls:null,rating_skill:4,rating_service:4,rating_atmosphere:4,rating_cleanliness:4,rating_explanation:4}};
const actions = () => within(screen.getByPlaceholderText('審査メモ（任意）').parentElement!);
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockDb() }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));
beforeEach(() => {
 jest.clearAllMocks(); global.fetch = mockFetch;
 mockFetch.mockReset();mutation.mockReset();mutation.mockResolvedValue({ok:true});
 mockFetch.mockImplementation((_url,options)=>options?.method==='PATCH'?mutation():Promise.resolve({ok:true,json:async()=>({snapshot})}));
 mockDb.mockImplementation(() => {
  const result = { data: [{ id, content_type: 'review', content_id: id, facility_id: null,
   report_reason: 'Synthetic report', auto_flags: [], status: 'pending', review_note: null, reviewed_at: null, created_at: '2026-10-08T00:00:00Z' }], error: null };
  const chain = { select: () => chain, order: () => chain, limit: () => chain, eq: () => chain,
   then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve) }; return { from: () => chain };
 });
});
test('moderation request carries the original displayed status alongside decision/note', async () => {
 render(<ModerationPage />); fireEvent.click(await screen.findByRole('button', { name: '審査する' }));
 await screen.findByText('Original content for moderation');
 fireEvent.change(screen.getByPlaceholderText('審査メモ（任意）'), { target: { value: 'Synthetic decision' } });
 fireEvent.click(actions().getByRole('button', { name: '却下', exact: true }));
 await screen.findByText('却下しました');
 expect(mockFetch).toHaveBeenCalledWith(`/api/admin/moderation/${id}`, expect.objectContaining({ body: JSON.stringify({ decision: 'rejected', expected_status: 'pending', expected_reviewed_at: null, expected_content_hash:'a'.repeat(64), review_note: 'Synthetic decision' }) }));
});
test('lost response followed by competing decision leaves original expected status and requires reload', async () => {
 mutation.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce({ ok: false, status: 409 });
 render(<ModerationPage />); fireEvent.click(await screen.findByRole('button', { name: '審査する' }));
 await screen.findByText('Original content for moderation');
 fireEvent.click(actions().getByRole('button', { name: '承認', exact: true }));
 await screen.findByText('審査結果を確認できませんでした。メモは保持されています。再読み込みして状態を確認してください');
 await waitFor(() => expect(actions().getByRole('button', { name: '承認', exact: true })).toBeEnabled());
 fireEvent.click(actions().getByRole('button', { name: '承認', exact: true }));
 await screen.findByText('審査状態が変更されています。再読み込みして確認してください');
 expect(mutation).toHaveBeenCalledTimes(2);expect(mockFetch).toHaveBeenCalledTimes(3);
 for (const [, init] of mockFetch.mock.calls.filter(([,init])=>init?.method==='PATCH')) expect(JSON.parse(init.body).expected_status).toBe('pending');
 expect(screen.queryByText('承認しました')).not.toBeInTheDocument();
});

test.each(['error','malformed','wrong-id','network'])('snapshot %s failure cannot approve an unseen review',async failure=>{
 mockFetch.mockImplementation(()=>failure==='network'?Promise.reject(new Error('lost snapshot')):Promise.resolve({ok:failure!=='error',json:async()=>({snapshot:failure==='malformed'?{}:failure==='wrong-id'?{...snapshot,id:'33333333-3333-4333-8333-333333333333'}:snapshot})}));
 render(<ModerationPage/>);fireEvent.click(await screen.findByRole('button',{name:'審査する'}));
 await screen.findByText(/審査する口コミ.*(?:確認できません|取得できませんでした)/);await waitFor(()=>expect(screen.getByRole('button',{name:'内容を再取得'})).toBeEnabled());
 expect(actions().getByRole('button',{name:'承認',exact:true})).toBeDisabled();expect(mutation).not.toHaveBeenCalled();
});
test('unsafe legacy photo prevents approval instead of displaying untrusted media',async()=>{
 mockFetch.mockResolvedValue({ok:true,json:async()=>({snapshot:{...snapshot,review:{...snapshot.review,photo_urls:['https://other.invalid/private.png']}}})});
 render(<ModerationPage/>);fireEvent.click(await screen.findByRole('button',{name:'審査する'}));
 await screen.findByText('写真を安全に確認できません。この口コミは審査できません');expect(actions().getByRole('button',{name:'承認',exact:true})).toBeDisabled();
});
