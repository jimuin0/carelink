/** @jest-environment jsdom */
import {render,screen,fireEvent,act} from '@testing-library/react';
import ShareButtons, { SHARE_ICON_CLASS } from '../ShareButtons';
const write=jest.fn();beforeEach(()=>{write.mockReset();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});});
test('clipboard failure is visible without an acknowledgement',async()=>{write.mockRejectedValue(new Error('Synthetic denial'));render(<ShareButtons url="https://example.invalid/one" title="Synthetic"/>);fireEvent.click(screen.getByLabelText('URLをコピー'));await screen.findByRole('alert');expect(screen.queryByRole('status')).toBeNull();});
test('changed share URL cannot inherit an older copy acknowledgement',async()=>{let finish!:()=>void;write.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));const r=render(<ShareButtons url="https://example.invalid/one" title="Synthetic"/>);fireEvent.click(screen.getByLabelText('URLをコピー'));r.rerender(<ShareButtons url="https://example.invalid/two" title="Synthetic"/>);await act(async()=>finish());expect(screen.queryByRole('status')).toBeNull();});

// 2026年10月23日: ブランド色の円（LINE 緑・X 黒・Facebook 青）は見出しより目立っていた。灰色のアイコンにそろえる。
test('share icons are neutral grey, keep their accessible names and a 44px target', () => {
  const { container } = render(<ShareButtons url="https://example.invalid/one" title="Synthetic"/>);
  expect(screen.getByRole('group', { name: 'このページを共有' })).toBeTruthy();
  for (const name of ['LINEで共有', 'Xで共有', 'Facebookで共有', 'URLをコピー']) {
    const el = screen.getByLabelText(name);
    expect(el.className).toBe(SHARE_ICON_CLASS);
    expect(el.className).toContain('min-w-[44px]');
    expect(el.className).toContain('min-h-[44px]');
    expect(el.className).toContain('text-gray-500');
  }
  expect(container.innerHTML).not.toMatch(/#06C755|#1877F2|bg-black|text-white/);
  // スマホでは見出しの下に並ぶので「共有」と文字でも示す（PC では隠す）
  expect(screen.getByText('共有').className).toContain('sm:hidden');
});
