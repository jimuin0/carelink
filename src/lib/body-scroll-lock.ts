/**
 * ページ本体（body）のスクロールを止める仕組みの単一の入口（2026年11月27日）。
 * スマホのメニュー・Modal・確認ダイアログが同時に開くことがあるため、止めている数を数え、
 * 全部が閉じたときだけ、最初に止める前の値へ戻す（片方を閉じただけで解けたり、
 * 閉じた後も止まったままになったりしないように・Codex 指摘 ML-01）。
 */
let locks = 0;
let saved = '';

/** スクロールを止める。戻すための関数を返す（2 回呼んでも 1 回分しか戻さない）。 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (locks === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = saved;
  };
}
