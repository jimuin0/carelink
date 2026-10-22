/**
 * バイト数を利用者向けの「n MB」表記にする（小数第1位で切り上げ）。
 * 写真の上限を「10,485,760バイト」と出しても伝わらないため、画面の文言は必ずこれを通す。
 * 切り上げにするのは、上限を超えた写真が「10MB」と表示されて上限内に見えるのを避けるため。
 */
export function formatMegabytes(bytes: number): string {
  return `${(Math.ceil((bytes / 1024 / 1024) * 10) / 10).toLocaleString('ja-JP')}MB`;
}
