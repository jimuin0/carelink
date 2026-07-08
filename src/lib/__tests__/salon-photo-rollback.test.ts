/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * rollbackUploadedSalonPhotos の回帰テスト。
 *
 * 【2026年7月8日 実データで確定した恒久根治】施設オーナー自己登録(register/page.tsx)で写真
 * アップロード成功後に /api/salons が失敗すると、アップロード済みファイルがストレージに孤児として
 * 残り続けていた。register/page.tsx の onSubmit は catch 節でこの関数を呼び、アップロード済み
 * パスをストレージから確実に削除する。
 */
const mockRemove = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({ remove: mockRemove })),
    },
  },
}));

import { rollbackUploadedSalonPhotos } from '../salon-photo-rollback';
import { supabase } from '@/lib/supabase';

describe('rollbackUploadedSalonPhotos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue({ error: null });
  });

  test('パス配列が空なら storage を一切呼ばない', async () => {
    await rollbackUploadedSalonPhotos([]);
    expect(supabase.storage.from).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  test('アップロード済みパスが1件ならそのパスで remove を呼ぶ', async () => {
    await rollbackUploadedSalonPhotos(['salons/uuid/exterior.jpg']);
    expect(supabase.storage.from).toHaveBeenCalledWith('carelink-uploads');
    expect(mockRemove).toHaveBeenCalledWith(['salons/uuid/exterior.jpg']);
  });

  test('アップロード済みパスが複数件なら全パスをまとめて remove する（回帰防止の核心）', async () => {
    const paths = ['salons/uuid/exterior.jpg', 'salons/uuid/interior_1.jpg', 'salons/uuid/menu_1.jpg'];
    await rollbackUploadedSalonPhotos(paths);
    expect(mockRemove).toHaveBeenCalledWith(paths);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  test('remove 自体が失敗しても例外を投げない（呼び出し元のトースト表示を妨げない）', async () => {
    mockRemove.mockRejectedValueOnce(new Error('storage error'));
    await expect(rollbackUploadedSalonPhotos(['salons/uuid/exterior.jpg'])).resolves.toBeUndefined();
  });
});
