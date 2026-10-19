/** @jest-environment jsdom */
import {render,screen,fireEvent,act} from '@testing-library/react';
import Page from '../page';
const mockWrite=jest.fn();
beforeEach(()=>{mockWrite.mockReset();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:mockWrite}});});
test('only acknowledges a resolved clipboard write and preserves exact JSON',async()=>{
 let finish!:()=>void;mockWrite.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));render(<Page/>);fireEvent.change(screen.getByLabelText('LIFF ID（マイページ用）'),{target:{value:'12345-Example'}});fireEvent.click(screen.getByText('JSONをコピー'));
 try {expect(screen.queryByText('✓ コピー済み')).toBeNull();expect(mockWrite).toHaveBeenCalledTimes(1);expect(JSON.parse(mockWrite.mock.calls[0][0]).areas[0].action.uri).toBe('https://liff.line.me/12345-Example/bookings');}finally{await act(async()=>finish());}
 expect(screen.getByText('✓ コピー済み')).toBeTruthy();
});
test('clipboard rejection remains failed without a false success',async()=>{mockWrite.mockRejectedValue(new Error('Synthetic permission denied'));render(<Page/>);fireEvent.click(screen.getByText('JSONをコピー'));await screen.findByRole('alert');expect(screen.queryByText('✓ コピー済み')).toBeNull();});
test('missing clipboard API offers manual selection',async()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});render(<Page/>);fireEvent.click(screen.getByText('JSONをコピー'));expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByText(/"chatBarText"/).getAttribute('tabindex')).toBe('0');});
test('double click cannot start a second in-flight write',async()=>{let finish!:()=>void;mockWrite.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));render(<Page/>);const button=screen.getByText('JSONをコピー');fireEvent.click(button);fireEvent.click(button);expect(mockWrite).toHaveBeenCalledTimes(1);await act(async()=>finish());});
test('editing the configuration invalidates the prior copy acknowledgement',async()=>{mockWrite.mockResolvedValue(undefined);render(<Page/>);fireEvent.click(screen.getByText('JSONをコピー'));await screen.findByText('✓ コピー済み');fireEvent.change(screen.getByLabelText('LIFF ID（マイページ用）'),{target:{value:'12345-Changed'}});expect(screen.queryByText('✓ コピー済み')).toBeNull();});
