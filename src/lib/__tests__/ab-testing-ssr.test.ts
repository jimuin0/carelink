/**
 * @jest-environment node
 *
 * 監査T5: trackAbEvent の SSR ガード（typeof window === 'undefined' → 早期 return）を
 * 実際に検証する。jsdom 環境では window が非configurableで undefined にできず、
 * 旧テスト（ab-testing.test.ts）は delete/代入が効かないまま空アサーションになっていた。
 * node 環境なら window は元から未定義なので、SSR 分岐を素直に発火させられる。
 */
import { trackAbEvent } from '../ab-testing';

describe('trackAbEvent — SSR（window 未定義）ガード', () => {
  test('window が無い環境では fetch を一切呼ばずに早期 return する', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    // @ts-expect-error node 環境の global に fetch を差し込む
    global.fetch = mockFetch;

    // node 環境なので typeof window === 'undefined' が真 → SSR ガードで即 return
    await trackAbEvent('exp-ssr', 'control', 'impression');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
