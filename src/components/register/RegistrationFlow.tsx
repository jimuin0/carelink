import { Fragment } from 'react';
import { REGISTRATION_STEPS, type RegistrationStepKey } from '@/lib/registration-flow';

/**
 * 掲載までの 4 ステップの図。トップ・/register/guide・受付完了・申込の続き・管理画面の上部で同じものを出す。
 *
 * 「まだ公開されません」を文章で何度も書く代わりに、図の上で「済」「いまここ」「これから」を見せる。
 * 状態は色だけに頼らない（済＝チェックの絵と「済」、いまここ＝文字ラベルと aria-current）。
 *
 * 【配色】.theme-ecru の変数だけを使う。「いまここ」の文字は --primary-dark（地色の上で 5.62:1・面の上で 6.08:1）。
 * --ecru-accent は地色の上で 4.33:1 しかないので小さい文字には使わない（塗りの上の白文字は 4.79:1 で可）。
 */
const ICONS: Record<RegistrationStepKey, string> = {
  apply: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  documents: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h4',
  publish: 'M3 10h18M5 10v10h14V10M3 10l2-6h14l2 6M10 20v-5h4v5',
};
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

type Props = {
  /** いま取り組んでいる手順。指定しなければ「済」「いまここ」を出さない（トップ・説明ページ用）。 */
  current?: RegistrationStepKey;
  /** 各手順の下に一言の説明を出すか。 */
  detailed?: boolean;
  className?: string;
};

export default function RegistrationFlow({ current, detailed = false, className = '' }: Props) {
  const currentIndex = current ? REGISTRATION_STEPS.findIndex(step => step.key === current) : -1;
  return (
    // 説明付き（detailed）はスマホで 4 列に並べると説明が 1 行 3〜4 文字で折れて読めないので、縦に並べる。
    <ol aria-label="掲載までの4ステップ" className={`grid ${detailed ? 'grid-cols-1 gap-5 sm:grid-cols-4 sm:gap-0' : 'grid-cols-4'} ${className}`}>
      {REGISTRATION_STEPS.map((step, index) => {
        const state = currentIndex < 0 ? 'plain' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        const circle = state === 'done'
          ? 'border-(--ecru-accent) bg-(--ecru-accent) text-white'
          : state === 'current'
            ? 'border-2 border-(--primary-dark) bg-(--ecru-surface) text-(--primary-dark) ring-4 ring-(--ecru-line)'
            : state === 'todo'
              ? 'border-(--ecru-muted) border-dashed bg-(--ecru-surface) text-(--ecru-muted)'
              : 'border-(--ecru-accent) bg-(--ecru-surface) text-(--ecru-accent)';
        return (
          <li key={step.key} aria-current={state === 'current' ? 'step' : undefined}
            className={`relative flex px-1 ${detailed ? 'items-center gap-4 text-left sm:flex-col sm:items-center sm:gap-0 sm:text-center' : 'flex-col items-center text-center'}`}>
            {index > 0 && (
              <span aria-hidden="true"
                className={`absolute ${detailed ? 'left-7 -top-5 h-5 w-px sm:left-auto sm:right-1/2 sm:top-6 sm:h-px sm:w-full sm:-translate-y-1/2' : 'right-1/2 top-6 h-px w-full -translate-y-1/2'} ${state === 'todo' ? 'border-t border-l border-dashed border-(--ecru-muted)' : 'bg-(--ecru-accent)'}`} />
            )}
            <span className={`relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${circle}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true" className="h-6 w-6">
                <path d={state === 'done' ? CHECK : ICONS[step.key]} />
              </svg>
            </span>
            <span className={`flex flex-col ${detailed ? 'items-start sm:items-center' : 'items-center'}`}>
              <span className={`${detailed ? 'sm:mt-2' : 'mt-2'} text-xs text-(--ecru-muted)`}>STEP {index + 1}</span>
              <span className="mt-0.5 break-keep text-sm font-bold leading-snug">
                {step.parts.map((part, i) => <Fragment key={part}>{i > 0 && <wbr />}{part}</Fragment>)}
                {state === 'done' && <span className="sr-only">（済）</span>}
              </span>
              {state === 'current' && <span className="mt-1 rounded-full bg-(--ecru-surface) px-2 text-xs font-bold text-(--primary-dark)">いまここ</span>}
              {state === 'done' && <span aria-hidden="true" className="mt-1 text-xs text-(--ecru-muted)">済</span>}
              {detailed && <span className="mt-1.5 text-xs leading-relaxed text-(--ecru-muted)">{step.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
