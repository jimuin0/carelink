import type { Ref } from 'react';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
  /**
   * 「ステップ n/N ラベル」の行。ステップを切り替えたとき、呼び出し側がここへ
   * フォーカスを移して読み上げさせる（tabIndex=-1 なのでタブ順には入らない）。
   */
  statusRef?: Ref<HTMLParagraphElement>;
}

/*
 * 配色は --primary（到達済み）と、.theme-ecru の中なら --ecru-*（未到達）を見る。
 * テーマ外（/recruit）では --ecru-* が未定義なので、Tailwind の灰色へ倒す。
 * 色コードはここに書かない（globals.css が単一ソース）。
 */
const TODO_CIRCLE = 'border border-[var(--ecru-line,var(--color-gray-300))] bg-[var(--ecru-surface,var(--color-gray-100))] text-[var(--ecru-muted,var(--color-gray-600))]';
const TODO_BAR = 'bg-[var(--ecru-line,var(--color-gray-200))]';
const MUTED_TEXT = 'text-[var(--ecru-muted,var(--color-gray-600))]';

export default function StepIndicator({ currentStep, totalSteps, labels, statusRef }: StepIndicatorProps) {
  const currentLabel = labels[currentStep - 1];
  return (
    <div className="mb-8">
      {/* 番号付きの順序なので ol。現在地は aria-current="step" で伝える（色だけに頼らない）。 */}
      <ol className="flex items-center justify-center gap-2" aria-label="入力の進み具合">
        {Array.from({ length: totalSteps }, (_, i) => {
          const reached = i + 1 <= currentStep;
          const done = i + 1 < currentStep;
          return (
            <li key={i} className="flex items-center gap-2" aria-current={i + 1 === currentStep ? 'step' : undefined}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    reached ? 'text-white' : TODO_CIRCLE
                  }`}
                  style={reached ? { backgroundColor: 'var(--primary)' } : undefined}
                  aria-hidden="true"
                >
                  {done ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                {/* スマホでは幅が足りないので見た目からは外し、読み上げにだけ残す。 */}
                <span className={`sr-only sm:not-sr-only sm:mt-1 sm:block sm:text-xs ${MUTED_TEXT}`}>
                  <span className="sr-only">{`ステップ${i + 1} `}</span>
                  {labels[i]}
                  <span className="sr-only">{done ? '（完了）' : i + 1 === currentStep ? '（現在のステップ）' : ''}</span>
                </span>
              </div>
              {i < totalSteps - 1 && (
                <div
                  className={`w-12 sm:w-20 h-1 rounded ${done ? '' : TODO_BAR}`}
                  style={done ? { backgroundColor: 'var(--primary)' } : undefined}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
      {/* スマホでは各丸の下のラベルを出す幅が無いので、現在地を文字で必ず出す。 */}
      <p
        ref={statusRef}
        tabIndex={-1}
        className="mt-3 scroll-mt-24 text-center text-sm font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-(--primary)"
      >
        ステップ {currentStep}/{totalSteps}
        {currentLabel ? ` ${currentLabel}` : ''}
      </p>
    </div>
  );
}
