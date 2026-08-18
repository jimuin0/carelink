/**
 * 口コミサマリーの【最初のフレーム】を検査する。
 *
 * 🔴 何を防いでいるか
 * AI 要約を取りに行くと決まっている（口コミ 3 件以上）のに、最初のフレームでは
 * ルールベース要約が見え、次のコミットでスケルトンへ差し替わっていた。利用者には
 * 「一度出た文章が消えてローディングに戻る」ちらつきとして見える。
 * effect のトップレベルに setLoading(true) を置いても、useEffect はコミット後に走るため
 * 最初のフレームには間に合わない（2026年8月16日に StationSearch で実測した欠陥と同型）。
 *
 * 【この検査の性質】
 * async IIFE で包む等の「lint の検出だけ消す」変更では通らない。最初のフレームの実 DOM を
 * 見ているので、原因（取得中であることがレンダー中に決まっていない）が残っていれば赤くなる。
 */
import type { FacilityReview } from '@/types';
import { mountFirstFrame } from '@/test-utils/first-frame';
import ReviewSummary from '../ReviewSummary';

function review(id: string, rating: number): FacilityReview {
  return {
    id,
    facility_id: 'facility-1',
    user_id: null,
    reviewer_name: 'テスト',
    rating,
    rating_skill: null,
    rating_service: null,
    rating_atmosphere: null,
    rating_cleanliness: null,
    rating_explanation: null,
    comment: null,
    photo_urls: null,
    is_verified_visit: null,
    status: 'published',
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

const REVIEWS = [review('r1', 5), review('r2', 4), review('r3', 5)];

/** ルールベース要約の本文（フォールバック）。最初のフレームに出てはいけない。 */
const RULE_SUMMARY_FRAGMENT = '3件の口コミで';

describe('ReviewSummary の最初のフレーム', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('AI 要約を取りに行く場合、最初のフレームからスケルトンを見せる（要約を出してから消さない）', async () => {
    // 応答を保留させる。解決させると「最初のフレームを見たのか完了後を見たのか」区別できない。
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<ReviewSummary reviews={REVIEWS} facilityId="facility-1" />);

    // 空振り防止: そもそもこのコンポーネントが描画されていることを確かめる。
    expect(handle.text()).toContain('口コミサマリー');
    // 取得前にルールベース要約を見せていない。
    expect(handle.text()).not.toContain(RULE_SUMMARY_FRAGMENT);
    expect(handle.container.querySelector('.animate-pulse')).not.toBeNull();

    handle.unmount();
  });

  it('取得に失敗したらルールベース要約へ落ちる', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network'))) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<ReviewSummary reviews={REVIEWS} facilityId="facility-1" />);
    await handle.settle();

    expect(handle.text()).toContain(RULE_SUMMARY_FRAGMENT);
    expect(handle.container.querySelector('.animate-pulse')).toBeNull();

    handle.unmount();
  });

  it('AI 要約が返ったら AI 要約を出す', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ summary: 'AI が作った要約' }) }),
    ) as unknown as typeof global.fetch;

    const handle = mountFirstFrame(<ReviewSummary reviews={REVIEWS} facilityId="facility-1" />);
    await handle.settle();

    expect(handle.text()).toContain('AI が作った要約');
    expect(handle.text()).toContain('AI要約');

    handle.unmount();
  });

  it('口コミが 3 件未満なら何も描画せず、取得もしない', () => {
    const fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const handle = mountFirstFrame(
      <ReviewSummary reviews={REVIEWS.slice(0, 2)} facilityId="facility-1" />,
    );

    expect(handle.text()).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();

    handle.unmount();
  });
});
