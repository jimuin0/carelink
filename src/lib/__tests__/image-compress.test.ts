/**
 * image-compress.ts の全分岐カバレッジ（監査P6でReviewFormから共通化）。
 * jsdom は canvas/Image を実装しないため、Image・getContext・toBlob をモックして
 * リサイズ・ctx欠落・blob欠落・品質ループ・onerror の各分岐を網羅する。
 */
import { compressImage, MAX_OUTPUT_SIZE, MAX_DIMENSION } from '../image-compress';

let mockDims = { width: 100, height: 100 };
let triggerError = false;
let drawImage: jest.Mock;

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
  drawImage = jest.fn();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage })) as never;
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
  // 元の寸法のまま描く
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 100, 100]);
});

test('横長（width>height かつ MAX 超）は width 基準でリサイズ', async () => {
  mockDims = { width: MAX_DIMENSION * 2, height: MAX_DIMENSION };
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
  // 長辺（幅）を MAX に合わせ、縦横比を保つ
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, MAX_DIMENSION, MAX_DIMENSION / 2]);
});

test('縦長（height>=width かつ MAX 超）は height 基準でリサイズ', async () => {
  mockDims = { width: MAX_DIMENSION, height: MAX_DIMENSION * 2 };
  const out = await compressImage(makeFile());
  expect(out).toBeInstanceOf(File);
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, MAX_DIMENSION / 2, MAX_DIMENSION]);
});

test('片辺だけ MAX を超える場合も長辺基準で縮め、端数は四捨五入する', async () => {
  mockDims = { width: 3000, height: 1001 };
  await compressImage(makeFile());
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, MAX_DIMENSION, Math.round((1001 * MAX_DIMENSION) / 3000)]);
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
  // 0.85 から 0.1 ずつ下げ、0.4 以下になった回で打ち切る（0.85, 0.75, 0.65, 0.55, 0.45, 0.35 の 6 回）
  const qualities = (HTMLCanvasElement.prototype.toBlob as jest.Mock).mock.calls.map((c) => c[2]);
  expect(qualities).toHaveLength(6);
  [0.85, 0.75, 0.65, 0.55, 0.45, 0.35].forEach((q, i) => expect(qualities[i]).toBeCloseTo(q));
});

test('目標サイズ以下になった時点で品質を下げるのをやめる', async () => {
  let n = 0;
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'size', { value: n++ === 0 ? MAX_OUTPUT_SIZE + 1 : MAX_OUTPUT_SIZE });
    cb(blob);
  }) as never;
  await compressImage(makeFile());
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2);
});

test('画像読み込みエラー（onerror）は reject する', async () => {
  triggerError = true;
  await expect(compressImage(makeFile())).rejects.toThrow('画像読み込みエラー');
});
