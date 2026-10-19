/** @jest-environment jsdom */
import {render,screen,fireEvent,act} from '@testing-library/react';
import ShareButtons from '../ShareButtons';
const write=jest.fn();beforeEach(()=>{write.mockReset();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});});
test('clipboard failure is visible without an acknowledgement',async()=>{write.mockRejectedValue(new Error('Synthetic denial'));render(<ShareButtons url="https://example.invalid/one" title="Synthetic"/>);fireEvent.click(screen.getByLabelText('URLをコピー'));await screen.findByRole('alert');expect(screen.queryByRole('status')).toBeNull();});
test('changed share URL cannot inherit an older copy acknowledgement',async()=>{let finish!:()=>void;write.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));const r=render(<ShareButtons url="https://example.invalid/one" title="Synthetic"/>);fireEvent.click(screen.getByLabelText('URLをコピー'));r.rerender(<ShareButtons url="https://example.invalid/two" title="Synthetic"/>);await act(async()=>finish());expect(screen.queryByRole('status')).toBeNull();});
