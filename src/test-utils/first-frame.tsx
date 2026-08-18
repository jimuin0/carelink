/**
 * 「開いた（押した）最初のフレームに何が見えていたか」を jsdom で決定的に捕まえる。
 *
 * 🔴 なぜ要るか（2026年8月16日に実機で見つかった実欠陥のクラス）
 * useEffect はコミット後（ブラウザではペイント後）に走る。そのため effect のトップレベルに
 * setLoading(true) を置いても【最初のフレームには間に合わない】。利用者には、まだ試しても
 * いない結果（「該当する駅がありません」等）が一瞬見えてから読み込み中へ変わる。
 * lint も tsc も通常の単体テストも通るため、コードを読むだけでは到達できない。
 *
 * 【なぜ MutationObserver を使わないか】
 * e2e（実ブラウザ）では MutationObserver で最初の出現を捕まえている。しかし jsdom の
 * MutationObserver はコールバックをマイクロタスクで配送し、複数コミット分の記録が 1 回の
 * コールバックへまとめて届く。フレーム境界が失われるため、単体テストでは使えない。
 *
 * 【この実装の原理】
 * - マウントは flushSync で 1 コミットだけを同期確定させる。パッシブエフェクト（useEffect）は
 *   スケジュールされるだけで、この時点では走っていない。
 * - クリックは act の外で dispatch する。React は discrete event の更新を同期レーンで処理して
 *   コミットするが、そこで新たに積まれたパッシブエフェクトは直後には走らない。
 * よって dispatch 直後の DOM ＝【押した最初のフレーム】そのものになる。
 * settle() を呼ぶと以降のコミットへ進む（2 フレーム目以降の検査用）。
 *
 * ⚠️ この検査は「症状」ではなく「原因」を見ている。async IIFE で包むなどして lint の検出だけを
 * 消しても、最初のフレームは変わらないのでここは赤いままになる。
 */
import { act, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

interface ActFlag {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

export interface FirstFrameHandle {
  /** マウント先。テスト側から querySelector する。 */
  container: HTMLElement;
  /** 直近のコミット時点の可視テキスト。 */
  text(): string;
  /** 保留中のエフェクトと解決済み Promise を全て流し、以降のコミットへ進める。 */
  settle(): Promise<void>;
  unmount(): void;
}

/**
 * act の外で更新を起こすため、React の「act で包め」警告を一時的に止める。
 * 警告を消すこと自体が目的ではなく、act で包むと【エフェクトまで流れてしまい】
 * 最初のフレームを観測できなくなるため、この検査では act を使えない。
 */
function withoutActWarning<T>(fn: () => T): T {
  const flag = globalThis as ActFlag;
  const previous = flag.IS_REACT_ACT_ENVIRONMENT;
  flag.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return fn();
  } finally {
    flag.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

/** 1 コミットだけを同期確定させてマウントする。戻った時点の DOM が最初のフレーム。 */
export function mountFirstFrame(ui: ReactElement): FirstFrameHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = withoutActWarning(() => {
    const created = createRoot(container);
    flushSync(() => created.render(ui));
    return created;
  });

  return {
    container,
    text: () => container.textContent ?? '',
    settle: async () => {
      const flag = globalThis as ActFlag;
      const previous = flag.IS_REACT_ACT_ENVIRONMENT;
      flag.IS_REACT_ACT_ENVIRONMENT = true;
      try {
        await act(async () => {});
      } finally {
        flag.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    },
    unmount: () => {
      withoutActWarning(() => {
        flushSync(() => root.unmount());
      });
      container.remove();
    },
  };
}

/**
 * act の外でクリックする。直後の DOM が【押した最初のフレーム】。
 * act(() => fireEvent.click(...)) ではエフェクトまで流れてしまい観測できない。
 */
export function clickFirstFrame(element: Element): void {
  withoutActWarning(() => {
    flushSync(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  });
}
