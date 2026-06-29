// 来院者（ゲスト）の施設レビュー投稿 E2E の共有定数。
// review.setup.ts が CI の隔離 Supabase（supabase start）に公開施設を service role で seed し、
// review.spec.ts が認証なし（ゲスト）で /facility/{slug} の口コミタブから投稿する。本番不可侵。

export const REVIEW_FACILITY_FILE = 'e2e/.auth/review-facility.json';

export const REVIEW_SEED = {
  reviewerName: 'E2Eレビュー太郎',
  comment: 'E2E自動テストによる口コミ本文です。施術が丁寧でした。',
};
