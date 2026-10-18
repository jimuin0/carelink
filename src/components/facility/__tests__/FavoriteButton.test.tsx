/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FavoriteButton from '../FavoriteButton';

const mockRead = jest.fn();
const mockAnalytics = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/facility/synthetic' }));
jest.mock('@/lib/analytics', () => ({ analytics: { favoriteToggled: (...args: unknown[]) => mockAnalytics(...args) } }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockRead }) }) }) }),
}) }));
beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue({ data: null, error: null });
  global.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});

test('one pending click cannot submit a second toggle and only a boolean receipt confirms it', async () => {
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
  render(<FavoriteButton facilityId="facility-a" />);
  const button = await screen.findByRole('button', { name: 'お気に入りに追加' });
  fireEvent.click(button); fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
  await act(async () => { resolve({ ok: true, json: async () => ({ isFavorited: true }) }); });
  expect(screen.getByRole('button', { name: 'お気に入りから削除' })).toBeEnabled();
  expect(mockAnalytics).toHaveBeenCalledWith('facility-a', 'add');
});

test('an invalid success response cannot confirm the optimistic state', async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
  render(<FavoriteButton facilityId="facility-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'お気に入りに追加' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'お気に入りに追加' })).toBeEnabled());
  expect(mockAnalytics).not.toHaveBeenCalled();
});

test('a completed old-facility toggle cannot change a new facility state or analytics', async () => {
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<FavoriteButton facilityId="facility-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'お気に入りに追加' }));
  view.rerender(<FavoriteButton facilityId="facility-b" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'お気に入りに追加' })).toBeEnabled());
  await act(async () => { resolve({ ok: true, json: async () => ({ isFavorited: true }) }); });
  expect(screen.getByRole('button', { name: 'お気に入りに追加' })).toBeEnabled();
  expect(mockAnalytics).not.toHaveBeenCalled();
});

test('a late initial read for another facility is discarded', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const view = render(<FavoriteButton facilityId="facility-a" />);
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  view.rerender(<FavoriteButton facilityId="facility-b" />);
  await screen.findByRole('button', { name: 'お気に入りに追加' });
  await act(async () => { resolve({ data: { id: 'old-favorite' }, error: null }); });
  expect(screen.getByRole('button', { name: 'お気に入りに追加' })).toBeEnabled();
});

test('an earlier visit to the same facility cannot overwrite a later visit',async()=>{
 let resolve!:(value:unknown)=>void;(fetch as jest.Mock).mockReturnValue(new Promise(r=>{resolve=r;}));
 const view=render(<FavoriteButton facilityId="facility-a" />);fireEvent.click(await screen.findByRole('button',{name:'お気に入りに追加'}));
 view.rerender(<FavoriteButton facilityId="facility-b" />);await screen.findByRole('button',{name:'お気に入りに追加'});
 view.rerender(<FavoriteButton facilityId="facility-a" />);await screen.findByRole('button',{name:'お気に入りに追加'});
 await act(async()=>{resolve({ok:true,json:async()=>({isFavorited:true})});});
 expect(screen.getByRole('button',{name:'お気に入りに追加'})).toBeEnabled();expect(mockAnalytics).not.toHaveBeenCalled();
});
