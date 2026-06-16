/**
 * @jest-environment jsdom
 *
 * ReviewForm の写真プレビュー blob URL ライフサイクルテスト。
 * 写真追加のたびに combined 全件の URL を作り直す際、旧プレビュー URL を revoke しないと
 * ドキュメント生存期間中リークする。生成前に旧 previews を revoke することを検証する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewForm from '@/components/facility/ReviewForm';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({}) }));

let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  global.URL.createObjectURL = jest.fn(() => `blob:mock-${urlCounter++}`);
  global.URL.revokeObjectURL = jest.fn();
  // compressImage が使う Image: src 設定で onload を発火させる
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 100;
    set src(_v: string) { Promise.resolve().then(() => this.onload && this.onload()); }
  }
  (global as unknown as { Image: unknown }).Image = MockImage;
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = jest.fn((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/jpeg' }))) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
});

function imageFile(name: string) {
  return new File(['data'], name, { type: 'image/jpeg' });
}

test('写真を追加するたびに既存プレビューの blob URL を revoke する（leak 防止・回帰防止）', async () => {
  render(<ReviewForm facilityId="f1" onReviewSubmitted={jest.fn()} />);
  const input = screen.getByLabelText('口コミ写真を選択') as HTMLInputElement;

  // 1枚目追加 → プレビュー1枚（firstUrl）
  fireEvent.change(input, { target: { files: [imageFile('a.jpg')] } });
  const img1 = (await screen.findByAltText('口コミ投稿用プレビュー写真1')) as HTMLImageElement;
  const firstUrl = img1.getAttribute('src')!;
  expect(firstUrl).toMatch(/^blob:mock-/);

  (URL.revokeObjectURL as jest.Mock).mockClear();

  // 2枚目追加 → combined を作り直す前に旧プレビュー(firstUrl)を revoke する
  fireEvent.change(input, { target: { files: [imageFile('b.jpg')] } });
  await screen.findByAltText('口コミ投稿用プレビュー写真2');

  await waitFor(() => {
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  });
});
