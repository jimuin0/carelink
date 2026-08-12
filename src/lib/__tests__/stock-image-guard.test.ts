/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * src/lib/stock-image-guard.ts の判定そのもの。
 *
 * 【この単体テストで何を守るか】
 * ・配信ホストが複数あるサービス（images./plus.unsplash.com）を「サブドメイン一致」で
 *   取りこぼさないこと。ホスト完全一致リストにすると必ず漏れる。
 * ・登録ドメインを部分文字列で見ていないこと（`notunsplash.com` を誤検知しない）。
 *   `hostname.includes('unsplash.com')` 実装だと通ってしまう欠陥の負の対照。
 * ・「既存値と同一なら素通し」が効くこと＝本番データの掃除より先にガードを入れても
 *   管理画面が壊れないという、このモジュールの存在理由そのもの。
 */
import {
  isStockImageUrl,
  isNewStockImage,
  STOCK_IMAGE_DOMAINS,
  STOCK_IMAGE_ERROR,
} from '../stock-image-guard';

describe('isStockImageUrl', () => {
  it('空値は false（未設定は違反ではない）', () => {
    expect(isStockImageUrl(null)).toBe(false);
    expect(isStockImageUrl(undefined)).toBe(false);
    expect(isStockImageUrl('')).toBe(false);
  });

  it('URL として解釈できない値は false（不正URLは zod .url() の担当）', () => {
    expect(isStockImageUrl('not-a-url')).toBe(false);
  });

  it('登録ドメインそのもの（ホスト完全一致）を弾く', () => {
    expect(isStockImageUrl('https://unsplash.com/photos/abc')).toBe(true);
  });

  it('サブドメイン配信ホストを弾く（実際に本番へ入った形）', () => {
    expect(
      isStockImageUrl('https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800')
    ).toBe(true);
    expect(isStockImageUrl('https://plus.unsplash.com/premium_photo-1')).toBe(true);
  });

  it('大文字ホスト名でも弾く（判定は小文字化してから行う）', () => {
    expect(isStockImageUrl('https://IMAGES.UNSPLASH.COM/photo-1')).toBe(true);
  });

  it('登録済みの全ドメインを弾く（一覧に足しただけで無効な項目が無い）', () => {
    for (const d of STOCK_IMAGE_DOMAINS) {
      expect(isStockImageUrl(`https://${d}/x.jpg`)).toBe(true);
      expect(isStockImageUrl(`https://cdn.${d}/x.jpg`)).toBe(true);
    }
  });

  // 負の対照: 部分文字列一致の実装だと true になってしまう入力。
  it('登録ドメインを末尾に含むだけの別ホストは弾かない', () => {
    expect(isStockImageUrl('https://notunsplash.com/x.jpg')).toBe(false);
    expect(isStockImageUrl('https://unsplash.com.evil.example/x.jpg')).toBe(false);
  });

  it('自 Supabase Storage の公開URLは弾かない（正常系を壊さない）', () => {
    expect(
      isStockImageUrl(
        'https://xzafxiupbflvgbarrihe.supabase.co/storage/v1/object/public/carelink-uploads/a.jpg'
      )
    ).toBe(false);
  });
});

describe('isNewStockImage', () => {
  const STOCK = 'https://images.unsplash.com/photo-1';

  it('ストック画像でなければ常に false', () => {
    expect(isNewStockImage('https://example.com/a.jpg', null)).toBe(false);
    expect(isNewStockImage(null, STOCK)).toBe(false);
  });

  it('既存値と異なるストック画像を入れようとしたら true（拒否）', () => {
    expect(isNewStockImage(STOCK, null)).toBe(true);
    expect(isNewStockImage(STOCK, 'https://images.unsplash.com/photo-2')).toBe(true);
  });

  it('既存値と同一なら false（画像を変えない更新を壊さない＝素通し）', () => {
    expect(isNewStockImage(STOCK, STOCK)).toBe(false);
  });

  it('previous 省略（新規作成）は true', () => {
    expect(isNewStockImage(STOCK)).toBe(true);
  });
});

it('拒否理由は「何をすればよいか」を含む', () => {
  expect(STOCK_IMAGE_ERROR).toContain('アップロード');
});
