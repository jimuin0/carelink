/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 口コミ評価（総合＋項目別）の集計（2026年10月22日 新設）。
 * 旧「NPS スコア」は回答経路が無く常に空だったため、公開中の口コミの平均に置き換えた。
 */
import {
  REVIEW_RATING_ITEMS,
  formatReviewAverage,
  readFacilitiesReviewRatings,
  readFacilityReviewRatings,
  summarizeReviewRatings,
  type ReviewRatingRow,
} from '../review-rating-summary';

const A = 'ab150000-0000-4000-8000-000000000001';
const B = 'ab150000-0000-4000-8000-000000000002';

function review(facility_id: string, rating: number | null, axes: Partial<Record<string, number | null>> = {}): ReviewRatingRow {
  return {
    facility_id, rating,
    rating_skill: null, rating_service: null, rating_atmosphere: null, rating_cleanliness: null, rating_explanation: null,
    ...axes,
  } as ReviewRatingRow;
}

describe('summarizeReviewRatings', () => {
  test('口コミが 0 件なら件数 0・総合も各項目も「まだ無い」（null）', () => {
    const summary = summarizeReviewRatings([]);
    expect(summary.count).toBe(0);
    expect(summary.overall).toBeNull();
    expect(summary.items.map((item) => [item.label, item.average, item.count])).toEqual([
      ['技術', null, 0], ['接客', null, 0], ['雰囲気', null, 0], ['清潔感', null, 0], ['施術の説明', null, 0],
    ]);
  });

  test('総合と 5 項目の平均を小数 1 桁で出す（項目名は口コミ投稿フォームと同じ）', () => {
    const summary = summarizeReviewRatings([
      review(A, 5, { rating_skill: 5, rating_service: 4, rating_atmosphere: 5, rating_cleanliness: 5, rating_explanation: 3 }),
      review(A, 4, { rating_skill: 4, rating_service: 4, rating_atmosphere: 3, rating_cleanliness: 5, rating_explanation: 4 }),
      review(A, 4, { rating_skill: 3, rating_service: 5, rating_atmosphere: 4, rating_cleanliness: 4, rating_explanation: 4 }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.overall).toBe(4.3); // 13/3=4.333…
    expect(Object.fromEntries(summary.items.map((item) => [item.key, item.average]))).toEqual({
      rating_skill: 4, rating_service: 4.3, rating_atmosphere: 4, rating_cleanliness: 4.7, rating_explanation: 3.7,
    });
    expect(REVIEW_RATING_ITEMS.map((item) => item.label)).toEqual(['技術', '接客', '雰囲気', '清潔感', '施術の説明']);
  });

  test('.x5 ちょうどは切り上げる（DB の ROUND(AVG(rating)::numeric, 1) と同じ値）', () => {
    // 4.25 / 4.35 / 4.45 は 2 進の浮動小数で .toFixed(1) や Math.round(avg*10) が食い違う代表例
    expect(summarizeReviewRatings([review(A, 4), review(A, 4), review(A, 4), review(A, 5)]).overall).toBe(4.3); // 4.25
    expect(summarizeReviewRatings([...Array(13).fill(review(A, 4)), ...Array(7).fill(review(A, 5))]).overall).toBe(4.4); // 4.35
    expect(summarizeReviewRatings([...Array(11).fill(review(A, 4)), ...Array(9).fill(review(A, 5))]).overall).toBe(4.5); // 4.45
  });

  test('項目を付けていない古い口コミは、その項目の母数に入れない（総合の件数には入る）', () => {
    const summary = summarizeReviewRatings([review(A, 5, { rating_skill: 5 }), review(A, 3)]);
    expect(summary.count).toBe(2);
    expect(summary.overall).toBe(4);
    const skill = summary.items.find((item) => item.key === 'rating_skill');
    expect(skill).toEqual({ key: 'rating_skill', label: '技術', average: 5, count: 1 });
    expect(summary.items.find((item) => item.key === 'rating_service')).toEqual({ key: 'rating_service', label: '接客', average: null, count: 0 });
  });

  test('1〜5 の整数以外は評価として数えない（平均を歪めない）', () => {
    const summary = summarizeReviewRatings([
      review(A, 5), review(A, 0), review(A, 6), review(A, 4.5), review(A, null),
      review(A, '5' as unknown as number),
    ]);
    expect(summary.count).toBe(6); // 件数は公開中の口コミの数
    expect(summary.overall).toBe(5);
  });
});

test('formatReviewAverage は小数 1 桁、まだ無い項目は「—」', () => {
  expect(formatReviewAverage(4)).toBe('4.0');
  expect(formatReviewAverage(4.3)).toBe('4.3');
  expect(formatReviewAverage(null)).toBe('—');
});

/** PostgREST のクエリビルダーの最小モック。呼び出しを記録し、range ごとに pages を返す。 */
function client(pages: (ReviewRatingRow[] | { error: unknown })[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  let page = 0;
  const db = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order']) {
        chain[method] = (...args: unknown[]) => { calls.push({ method, args }); return chain; };
      }
      chain.range = (...args: unknown[]) => {
        calls.push({ method: 'range', args });
        const next = pages[page++] ?? [];
        return Promise.resolve(Array.isArray(next) ? { data: next, error: null } : { data: null, error: next.error });
      };
      return chain;
    },
  };
  return { db: db as unknown as Parameters<typeof readFacilityReviewRatings>[0], calls };
}

describe('readFacilityReviewRatings（1 店舗）', () => {
  test('公開中かつ非表示フラグの無い口コミだけを、その店舗に絞って読む', async () => {
    const { db, calls } = client([[review(A, 5), review(A, 4)]]);
    const { summary, error } = await readFacilityReviewRatings(db, A);
    expect(error).toBeNull();
    expect(summary.count).toBe(2);
    expect(summary.overall).toBe(4.5);
    expect(calls).toEqual(expect.arrayContaining([
      { method: 'from', args: ['facility_reviews'] },
      { method: 'eq', args: ['status', 'published'] },
      { method: 'eq', args: ['is_flagged', false] },
      { method: 'eq', args: ['facility_id', A] },
      { method: 'order', args: ['id', { ascending: true }] },
      { method: 'range', args: [0, 999] },
    ]));
  });

  test('1000 件を超えてもページングして全件を数える（max_rows で黙って打ち切らない）', async () => {
    const { db, calls } = client([Array(1000).fill(review(A, 5)), [review(A, 1)]]);
    const { summary } = await readFacilityReviewRatings(db, A);
    expect(summary.count).toBe(1001);
    expect(calls.filter((call) => call.method === 'range').map((call) => call.args)).toEqual([[0, 999], [1000, 1999]]);
  });

  test('読み取り失敗は error として返す（呼び出し側が「0 件」と表示しない）', async () => {
    const failure = { code: '08006' };
    const { db } = client([{ error: failure }]);
    const { error } = await readFacilityReviewRatings(db, A);
    expect(error).toBe(failure);
  });
});

describe('readFacilitiesReviewRatings（チェーン）', () => {
  test('店舗ごとに分けて集計し、口コミの無い店舗も 0 件として返す', async () => {
    const { db, calls } = client([[review(A, 5, { rating_skill: 4 }), review(A, 3, { rating_skill: 2 })]]);
    const { summaries, error } = await readFacilitiesReviewRatings(db, [A, B]);
    expect(error).toBeNull();
    expect(summaries.get(A)?.count).toBe(2);
    expect(summaries.get(A)?.overall).toBe(4);
    expect(summaries.get(A)?.items[0].average).toBe(3);
    expect(summaries.get(B)).toEqual(summarizeReviewRatings([]));
    expect(calls).toEqual(expect.arrayContaining([
      { method: 'in', args: ['facility_id', [A, B]] },
      { method: 'eq', args: ['status', 'published'] },
      { method: 'eq', args: ['is_flagged', false] },
    ]));
  });

  test('読み取り失敗は error として返す', async () => {
    const failure = new Error('synthetic');
    const { db } = client([{ error: failure }]);
    const { error } = await readFacilitiesReviewRatings(db, [A, B]);
    expect(error).toBe(failure);
  });
});
