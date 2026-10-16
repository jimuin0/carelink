/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '../page';
import FavoritesError from '../error';
const mockFavorites=jest.fn();
jest.mock('@/lib/user',()=>({getUserFavorites:()=>mockFavorites()}));
jest.mock('@/components/search/FacilityCard',()=>({__esModule:true,default:()=> <div>favorite-facility</div>}));
beforeEach(()=>jest.clearAllMocks());

test('failed reads reject the page and show a retry error instead of a fabricated empty state',async()=>{
 mockFavorites.mockRejectedValue(new Error('FAVORITES_UNAVAILABLE'));
 await expect(Page()).rejects.toThrow('FAVORITES_UNAVAILABLE');
 const html=renderToStaticMarkup(<FavoritesError />);
 expect(html).toContain('role="alert"');expect(html).toContain('お気に入りを取得できませんでした');expect(html).toContain('再試行');expect(html).not.toContain('お気に入りがありません');
});
test('retry reloads only the current document',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');const reload=jest.fn();
 try {
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{reload}}});
  const view=FavoritesError();view.props.onRetry();expect(reload).toHaveBeenCalledTimes(1);expect(mockFavorites).not.toHaveBeenCalled();
 } finally {
  if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');
 }
});
test('a successful empty query preserves the genuine empty state',async()=>{
 mockFavorites.mockResolvedValue([]);const html=renderToStaticMarkup(await Page());expect(html).toContain('お気に入りがありません');expect(html).not.toContain('role="alert"');
});
test('a successful nonempty query preserves facility cards',async()=>{
 mockFavorites.mockResolvedValue([{id:'synthetic-favorite',facility:{id:'synthetic-facility'}}]);const html=renderToStaticMarkup(await Page());expect(html).toContain('favorite-facility');expect(html).not.toContain('お気に入りがありません');
});
