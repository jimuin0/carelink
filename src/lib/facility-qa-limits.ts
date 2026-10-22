/**
 * 施設 Q&A の質問・回答の上限（画面・API・DB で同じ値）。
 *
 * 質問: 店舗ページの入力欄（src/components/facility/QASection.tsx の maxLength）、
 * 質問の登録 API（src/app/api/facility/qa/route.ts）、DB の CHECK 制約
 * （facility_qa_question_check: length(question) <= 500）が同じ上限を使う。
 *
 * 回答: 管理画面の入力欄（src/app/admin/qa/page.tsx の maxLength と文字数表示）、
 * 回答 API（src/app/api/admin/qa/route.ts）、DB の CHECK 制約
 * （facility_qa_answer_check: length(answer) <= 1000）が同じ上限を使う。
 * 以前は画面と API が 2000 文字まで受け付けていたため、1001〜2000 文字の回答は
 * DB の CHECK で弾かれて 500（「回答の送信に失敗しました」）になり、質問が未回答のまま残った。
 *
 * 画面（クライアント）からも読むので、サーバー専用のモジュールを import しないこと。
 */
export const FACILITY_QA_QUESTION_MAX_LENGTH = 500;

export const FACILITY_QA_QUESTION_LENGTH_MESSAGE = `質問を1〜${FACILITY_QA_QUESTION_MAX_LENGTH}文字で入力してください`;

export const FACILITY_QA_ANSWER_MAX_LENGTH = 1000;
