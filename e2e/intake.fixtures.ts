// 来院者（ゲスト）の問診票回答 E2E の共有定数。
// intake.setup.ts が CI の隔離 Supabase（supabase start）に公開施設＋有効な問診テンプレートを
// service role で seed し、intake.spec.ts が認証なし（ゲスト）で /intake/{slug} に回答を送信する。
// 本番には一切触れない。

// setup が seed した施設 slug を書き出すファイル（spec が読んで /intake/{slug} を開く）。
export const INTAKE_FACILITY_FILE = 'e2e/.auth/intake-facility.json';

export const INTAKE_SEED = {
  customerName: 'E2E問診来院者',
};
