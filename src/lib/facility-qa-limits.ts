/**
 * 施設 Q&A の質問の上限（画面・API・DB で同じ値）。
 *
 * 店舗ページの入力欄（src/components/facility/QASection.tsx の maxLength）、
 * 質問の登録 API（src/app/api/facility/qa/route.ts）、DB の CHECK 制約
 * （facility_qa_question_check: length(question) <= 500）が同じ上限を使う。
 *
 * 画面（クライアント）からも読むので、サーバー専用のモジュールを import しないこと。
 */
export const FACILITY_QA_QUESTION_MAX_LENGTH = 500;

export const FACILITY_QA_QUESTION_LENGTH_MESSAGE = `質問を1〜${FACILITY_QA_QUESTION_MAX_LENGTH}文字で入力してください`;
