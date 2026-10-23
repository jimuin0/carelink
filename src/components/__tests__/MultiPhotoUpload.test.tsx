/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MultiPhotoUpload from '../MultiPhotoUpload';

const readers: DeferredReader[] = [];
class DeferredReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() { readers.push(this); }
  finish(result: string) { this.result = result; this.onload?.(); }
}
const NativeReader = global.FileReader;
beforeEach(() => { readers.length = 0; global.FileReader = DeferredReader as unknown as typeof FileReader; });
afterEach(() => { global.FileReader = NativeReader; });
const slots = [{ label: '外観' }, { label: '内観' }];
const photo = (name: string) => new File(['fixture'], name, { type: 'image/png' });
const preview = 'data:image/png;base64,Zml4dHVyZQ==';

test('concurrent reads in different slots cannot erase the other selected file', () => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  const inputs = container.querySelectorAll('input[type="file"]');
  const first = photo('first.png'); const second = photo('second.png');
  fireEvent.change(inputs[0], { target: { files: [first] } });
  fireEvent.change(inputs[1], { target: { files: [second] } });
  act(() => { readers[1].finish(preview); readers[0].finish(preview); });
  expect(onChange).toHaveBeenLastCalledWith([first, second]);
  expect(screen.getByAltText('外観')).toBeVisible();
  expect(screen.getByAltText('内観')).toBeVisible();
});

test('late read cannot restore a replaced file; remove prevents hidden submission', () => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  const input = container.querySelector('input[type="file"]')!;
  const second = photo('replacement.png');
  fireEvent.change(input, { target: { files: [photo('old.png')] } });
  fireEvent.change(input, { target: { files: [second] } });
  act(() => { readers[1].finish(preview); });
  fireEvent.click(screen.getByRole('button', { name: '外観の写真を削除' }));
  act(() => { readers[0].finish(preview); });
  expect(onChange).toHaveBeenLastCalledWith([null, null]);
  expect(screen.queryByAltText('外観')).not.toBeInTheDocument();
});

test('failed preview removes the unreadable file and reports the failure', () => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [photo('bad.png')] } });
  act(() => { readers[0].onerror?.(); });
  expect(onChange).toHaveBeenLastCalledWith([null, null]);
  expect(screen.getByRole('alert')).toHaveTextContent('写真を読み込めませんでした');
});

test.each(['type', 'size'])('invalid %s replacement cannot leave an invisible previous selection', (failure) => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [photo('old.png')] } });
  const invalid = new File(['invalid'], 'invalid.file', { type: failure === 'type' ? 'text/plain' : 'image/png' });
  if (failure === 'size') Object.defineProperty(invalid, 'size', { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(input, { target: { files: [invalid] } });
  act(() => { readers[0].finish(preview); });
  expect(onChange).toHaveBeenLastCalledWith([null, null]);
  expect(screen.queryByAltText('外観')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeVisible();
});

test('restored sparse original files populate previews and survive changing another slot in order', () => {
  const original = photo('original.png'); const replacement = photo('replacement.png'); const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} initialFiles={[original, null]} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled(); act(() => { readers[0].finish(preview); });
  expect(screen.getByAltText('外観')).toBeVisible();
  fireEvent.change(container.querySelectorAll('input[type="file"]')[0], { target: { files: [replacement] } });
  expect(onChange).toHaveBeenLastCalledWith([original, replacement]);
});
test('restored preview failure preserves original file when another slot changes', () => {
  const original = photo('original.png'); const other = photo('other.png'); const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} initialFiles={[original, null]} onChange={onChange} />);
  act(() => { readers[0].onerror?.(); });
  expect(screen.getByRole('alert')).toHaveTextContent('元の写真は保持されています');
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], { target: { files: [other] } });
  expect(onChange).toHaveBeenLastCalledWith([original, other]);
});

// 【2026年10月23日】入力欄が display:none（hidden）だとキーボードで到達できず、写真を追加できなかった。
test('every file input stays reachable by keyboard (sr-only, never display:none) and the slot shows a focus ring', () => {
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={jest.fn()} />);
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  expect(inputs.length).toBe(slots.length + 1);
  for (const input of inputs) {
    expect(input).not.toHaveClass('hidden');
    expect(input).toHaveClass('sr-only');
    expect(input.tabIndex).not.toBe(-1);
    expect(input.closest('label')!.className).toMatch(/focus-within:ring-2/);
  }
});

test('size errors are explained in MB, not bytes', () => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  const large = new File(['x'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 12.3 * 1024 * 1024 });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [large] } });
  expect(screen.getByRole('alert')).toHaveTextContent('10MB以下にしてください（選択した写真：12.3MB）');
});

test('a large photo is accepted when the same client-side compression brings it under the limit', async () => {
  const onChange = jest.fn();
  const smaller = new File(['small'], 'large.jpg', { type: 'image/jpeg' });
  const compress = jest.fn().mockResolvedValue(smaller);
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} compress={compress} />);
  const large = new File(['x'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 15 * 1024 * 1024 });
  await act(async () => { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [large] } }); });
  expect(compress).toHaveBeenCalledWith(large);
  expect(onChange).toHaveBeenLastCalledWith([smaller, null]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each([
  ['still too large', () => { const f = new File(['x'], 'still.jpg', { type: 'image/jpeg' }); Object.defineProperty(f, 'size', { value: 11 * 1024 * 1024 }); return Promise.resolve(f); }],
  ['compression failure', () => Promise.reject(new Error('decode failed'))],
])('a large photo is rejected in MB when compression does not help (%s)', async (_label, result) => {
  const onChange = jest.fn();
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} compress={jest.fn(result)} />);
  const large = new File(['x'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 15 * 1024 * 1024 });
  await act(async () => { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [large] } }); });
  expect(onChange).toHaveBeenLastCalledWith([null, null]);
  expect(screen.getByRole('alert')).toHaveTextContent('10MB以下にしてください');
});

test('a stale compression result cannot overwrite a newer selection in the same slot', async () => {
  const onChange = jest.fn();
  let resolveCompress: (file: File) => void = () => undefined;
  const compress = jest.fn(() => new Promise<File>(resolve => { resolveCompress = resolve; }));
  const { container } = render(<MultiPhotoUpload slots={slots} onChange={onChange} compress={compress} />);
  const input = container.querySelector('input[type="file"]')!;
  const large = new File(['x'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 15 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [large] } });
  const newer = photo('newer.png');
  fireEvent.change(input, { target: { files: [newer] } });
  await act(async () => { resolveCompress(new File(['small'], 'large.jpg', { type: 'image/jpeg' })); });
  expect(onChange).toHaveBeenLastCalledWith([newer, null]);
});

test('several photos can be chosen at once and fill only the empty slots in order', () => {
  const onChange = jest.fn();
  const three = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
  const { container } = render(<MultiPhotoUpload slots={three} onChange={onChange} />);
  const existing = photo('existing.png');
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], { target: { files: [existing] } });
  const bulk = screen.getByLabelText('写真をまとめて選ぶ（空いている枠へ順に追加）');
  expect(bulk).toHaveAttribute('multiple');
  const first = photo('first.png'); const second = photo('second.png'); const extra = photo('extra.png');
  fireEvent.change(bulk, { target: { files: [first, second, extra] } });
  expect(onChange).toHaveBeenLastCalledWith([first, existing, second]);
  expect(screen.getByRole('status')).toHaveTextContent('1枚は追加していません');
  onChange.mockClear();
  fireEvent.change(bulk, { target: { files: [] } });
  expect(onChange).not.toHaveBeenCalled();
});

test('choosing exactly as many photos as empty slots shows no warning', () => {
  const onChange = jest.fn();
  render(<MultiPhotoUpload slots={slots} onChange={onChange} />);
  const first = photo('first.png'); const second = photo('second.png');
  fireEvent.change(screen.getByLabelText('写真をまとめて選ぶ（空いている枠へ順に追加）'), { target: { files: [first, second] } });
  expect(onChange).toHaveBeenLastCalledWith([first, second]);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
