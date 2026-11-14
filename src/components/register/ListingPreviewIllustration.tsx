/**
 * 掲載するとお客様からどう見えるかの図（スマホ画面のイメージ）。
 *
 * 実在の店舗の画面や写真は使わない（2026年10月23日 神原さん決定「実際の掲載例は載せない」）。
 * 中身は灰色の帯と記号だけの模式図にして、「見本の店」と読める固有の名前・数字も書かない。
 * 色は .theme-ecru の変数だけ。文字は 12px（text-xs）未満にしない。
 */
const CALLOUTS = [
  { n: 1, label: '写真' },
  { n: 2, label: 'メニューと料金' },
  { n: 3, label: '予約ボタン（設定後）' },
];

function Badge({ n }: { n: number }) {
  return (
    <span aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--ecru-accent) text-xs font-bold text-white">
      {n}
    </span>
  );
}

export default function ListingPreviewIllustration({ className = '' }: { className?: string }) {
  return (
    <figure aria-label="お客様に見える店舗ページ（イメージ）" className={`flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-12 ${className}`}>
      {/* 画面の中身は飾り。意味は右の番号つきの一覧と figcaption で伝える。 */}
      <div aria-hidden="true"
        className="w-[220px] rounded-[28px] border-[5px] border-(--ecru-text) bg-(--ecru-surface) p-3 shadow-sm">
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-(--ecru-line)" />
        <div className="relative flex h-24 items-center justify-center rounded-lg bg-(--ecru-line) text-(--ecru-muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            strokeLinejoin="round" className="h-9 w-9">
            <path d="M4 18l5-6 4 4 3-3 4 5M4 5h16v14H4zM15.5 9.5h.01" />
          </svg>
          <span className="absolute -left-2 -top-2"><Badge n={1} /></span>
        </div>
        <div className="mt-3 h-3 w-3/4 rounded bg-(--ecru-text)" />
        <div className="mt-2 flex gap-0.5 text-(--ecru-accent)">
          {[0, 1, 2, 3, 4].map(i => (
            <svg key={i} viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
              <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
            </svg>
          ))}
        </div>
        <div className="relative mt-3 space-y-2 border-t border-(--ecru-line) pt-3">
          <span className="absolute -left-5 top-2"><Badge n={2} /></span>
          {['w-1/2', 'w-2/5', 'w-3/5'].map(width => (
            <div key={width} className="flex items-center justify-between">
              <div className={`h-2 rounded bg-(--ecru-muted) ${width}`} />
              <div className="h-2 w-8 rounded bg-(--ecru-line)" />
            </div>
          ))}
        </div>
        <div className="relative mt-4 flex h-9 items-center justify-center rounded-lg bg-(--ecru-accent) text-xs font-bold text-white">
          予約する
          <span className="absolute -right-2 -top-2"><Badge n={3} /></span>
        </div>
      </div>
      <div>
        <ol className="space-y-3 text-sm">
          {CALLOUTS.map(c => (
            <li key={c.n} className="flex items-center gap-3"><Badge n={c.n} />{c.label}</li>
          ))}
        </ol>
        <figcaption className="mt-4 text-xs text-(--ecru-muted)">お客様に見える店舗ページ（イメージ）</figcaption>
      </div>
    </figure>
  );
}
