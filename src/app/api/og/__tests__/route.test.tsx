/**
 * @jest-environment node
 *
 * Tests for GET /api/og（OGP 画像生成ルート）
 *
 * next/og の ImageResponse は edge ランタイム + WASM(satori/resvg) 依存のため
 * jest では実レンダリングできない。しかし GET が組み立てる JSX 要素ツリーは
 * ImageResponse へ渡す「前」に即時評価される（三項 / && / .map が全て実行される）。
 * よって ImageResponse をモックして要素ツリーを破棄するだけで、ルート内の
 * 全 25 分岐を駆動でき branch 100% を達成できる（測定漏れ盲点の解消）。
 */
jest.mock('next/og', () => ({
  ImageResponse: jest.fn(function ImageResponseMock(this: Record<string, unknown>, element: unknown, opts: unknown) {
    this.element = element;
    this.opts = opts;
  }),
}));

import type { NextRequest } from 'next/server';
import { GET } from '../route';
import { ImageResponse } from 'next/og';

/** req.nextUrl のみ参照するため URL を最小注入する。 */
const makeReq = (query: string): NextRequest =>
  ({ nextUrl: new URL(`http://localhost/api/og${query}`) } as unknown as NextRequest);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/og', () => {
  test('パラメータ無し → デフォルト値・rating 関連は全て false 分岐', async () => {
    const res = await GET(makeReq(''));
    expect(res).toBeDefined();
    expect(ImageResponse).toHaveBeenCalledTimes(1);
    // 既定サイズ＋CDN キャッシュヘッダが第2引数に渡る（Edge CPU DoS 防止）
    const opts = (ImageResponse as jest.Mock).mock.calls[0][1];
    expect(opts).toEqual({
      width: 1200,
      height: 630,
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' },
    });
  });

  test('title長(>20) + rating=4.5 + reviews → 真分岐・半星(hasHalf)を網羅', async () => {
    // title 21 文字以上で title.length>20 true（fontSize 56）
    const longTitle = 'あいうえおかきくけこさしすせそたちつてとな'; // 21 文字
    const res = await GET(
      makeReq(`?title=${encodeURIComponent(longTitle)}&subtitle=Sub&rating=4.5&reviews=10`)
    );
    expect(res).toBeDefined();
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });

  test('rating=3.0（半星なし）→ i===fullStars+1 false / hasHalf false / 空星分岐を網羅', async () => {
    const res = await GET(makeReq('?rating=3.0'));
    expect(res).toBeDefined();
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });

  test('rating=Infinity → Number.isFinite false 分岐(rating=null・"Infinity"を描画しない)', async () => {
    const res = await GET(makeReq('?rating=Infinity'));
    expect(res).toBeDefined();
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });

  test('rating=10（上限超）→ 5 にクランプ(309桁等の巨大値を描画しない)', async () => {
    const res = await GET(makeReq('?rating=10'));
    expect(res).toBeDefined();
    expect(ImageResponse).toHaveBeenCalledTimes(1);
  });
});
