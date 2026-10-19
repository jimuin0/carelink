/** @jest-environment jsdom */
import {render,screen,fireEvent} from '@testing-library/react';
import Page from '../page';
jest.mock('next/image',()=>({__esModule:true,default:()=>null}));
const mockFetch=jest.fn();global.fetch=mockFetch;
beforeEach(()=>{mockFetch.mockReset();});
test('platform-only operator loads inactive entries without a facility membership lookup',async()=>{
 mockFetch.mockResolvedValue({ok:true,json:async()=>({features:[{id:'f1',title:'Owned inactive feature',subtitle:null,image_url:null,href:null,is_active:false,sort_order:0}]})});render(<Page/>);await screen.findByText('Owned inactive feature');expect(mockFetch).toHaveBeenCalledWith('/api/admin/features',{cache:'no-store'});
});
test.each([{features:null},{features:[{}]},{}])('malformed listing remains unavailable %p',async data=>{
 mockFetch.mockResolvedValue({ok:true,json:async()=>data});render(<Page/>);await screen.findByRole('alert');expect(screen.queryByText(/特集がまだ/)).toBeNull();mockFetch.mockResolvedValue({ok:true,json:async()=>({features:[]})});fireEvent.click(screen.getByText('再試行'));await screen.findByText('特集を追加');
});
