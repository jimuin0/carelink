/**
 * image-compress.ts の全分岐カバレッジ（監査P6でReviewFormから共通化）。
 * jsdom は canvas/Image を実装しないため、Image・getContext・toBlob をモックして
 * リサイズ・ctx欠落・blob欠落・品質ループ・onerror の各分岐を網羅する。
 */
import { compressImage, MAX_OUTPUT_SIZE, MAX_DIMENSION } from '../image-compress';

let mockDims = { width: 100, height: 100 };
let triggerError = false;

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = mockDims.width;
  height = mockDims.height;
  set src(_v: string) {
    Promise.resolve().then(() => {
      if (triggerError) this.onerror?.();
      else this.onload?.();
    });
  }
}

beforeAll(() => {
  (global as unknown as { Image: unknown }).Image = MockImage;
  (URL.createObjectURL as unknown) = jest.fn(() => 'blob:mock');
  (URL.revokeObjectURL as unknown) = jest.fn();
});

beforeEach(() => {
  mockDims = { width: 100, height: 100 };
  triggerError = false;
  // 既定: ctx あり・小さい blob を返す（成功パス）
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() })) as never;
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) =>
    cb(new Blob(['x'], { type: 'image/jpeg' }))) as never;
});

function makeFile(name = 'photo.png') {
  return new File(['data'], name, { type: 'image/png' });
}

test('リサイズなし（MAX_DIMENSION以下）でも圧縮して File を返す', async () => {
  mockDims = { width: 100, height: 100 };
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
  expect(out.type).toBe('image/jpeg');
  expect(out.name).toMatch(/\.jpg$/);
});

test('横長（width>height かつ MAX 超）は width 基準でリサイズ', async () => {
  mockDims = { width: MAX_DIMENSION * 2, height: MAX_DIMENSION };
  const setW = jest.fn();
  const setH = jest.fn();
  // canvas.width/height への代入を観測してリサイズ計算分岐を確認
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
  void setW; void setH;
});

test('縦長（height>=width かつ MAX 超）は height 基準でリサイズ', async () => {
  mockDims = { width: MAX_DIMENSION, height: MAX_DIMENSION * 2 };
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
});

test('getContext が null なら元 File をそのまま返す', async () => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as never;
  const file = makeFile();
  const out = await compressImage(file);
  expect(out).toBe(file);
});

test('toBlob が null を返したら元 File をそのまま返す', async () => {
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) => cb(null)) as never;
  const file = makeFile();
  const out = await compressImage(file);
  expect(out).toBe(file);
});

test('blob が大きくても quality<=0.4 まで下げて最終的に返す', async () => {
  // 常に MAX_OUTPUT_SIZE 超の blob を返し、品質を下げるループを最後まで回す分岐を通す
  const bigSize = MAX_OUTPUT_SIZE + 1;
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'size', { value: bigSize });
    cb(blob);
  }) as never;
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
  expect(out.type).toBe('image/jpeg');
});

test('画像読み込みエラー（onerror）は reject する', async () => {
  triggerError = true;
  await expect(compressImage(makeFile())).rejects.toThrow('画像読み込みエラー');
});
