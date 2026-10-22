/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '../page';
import FavoritesError from '../error';
const mockFavorites=jest.fn();
jest.mock('@/lib/user',()=>({getUserFavorites:()=>mockFavorites()}));
jest.mock('next/navigation',()=>({useRouter:()=>({refresh:jest.fn()})}));
jest.mock('@/components/search/FacilityCard',()=>({__esModule:true,default:({facility}: {facility:unknown})=> {if(!facility)throw new Error('Cannot render an unavailable facility');return <div>favorite-facility</div>;}}));
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


test('an unavailable joined facility retains the favorite without rendering a broken card or false empty state',async()=>{
 mockFavorites.mockResolvedValue([{id:'synthetic-unavailable',facility:null}]);
 const html=renderToStaticMarkup(await Page());expect(html).toContain('施設情報を現在表示できません');expect(html).toContain('お気に入りの登録は保持されています');expect(html).not.toContain('お気に入りがありません');expect(html).not.toContain('favorite-facility');
});
test('one unavailable facility cannot hide other available favorite cards',async()=>{
 mockFavorites.mockResolvedValue([{id:'synthetic-unavailable',facility:null},{id:'synthetic-available',facility:{id:'synthetic-facility'}}]);
 const html=renderToStaticMarkup(await Page());expect(html).toContain('施設情報を現在表示できません');expect(html).toContain('favorite-facility');expect(html).not.toContain('お気に入りがありません');
});

// 掲載が下書き・停止に戻った施設のお気に入りは、施設ページが 404 でハートも押せない。以前はこのカードに
// 操作が無く外す手段が無かったので、カードに「お気に入りから外す」を出す（2026年10月23日）。
test('an unavailable facility card offers removal of that favorite; available cards keep their own card',async()=>{
 mockFavorites.mockResolvedValue([{id:'synthetic-unavailable',facility_id:'fa7f0001-0000-4000-8000-000000000002',facility:null},{id:'synthetic-available',facility_id:'fa7f0001-0000-4000-8000-000000000001',facility:{id:'synthetic-facility'}}]);
 const html=renderToStaticMarkup(await Page());
 expect(html.match(/お気に入りから外す/g)).toHaveLength(1);expect(html).toContain('掲載が再開されると、ここに表示されます');expect(html).toContain('favorite-facility');
});
