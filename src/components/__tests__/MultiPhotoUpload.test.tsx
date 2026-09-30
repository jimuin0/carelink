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
