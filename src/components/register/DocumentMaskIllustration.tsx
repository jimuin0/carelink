/**
 * 確認書類の「見せる所」と「隠してよい所」の見本（公共料金の請求書を模した図）。
 *
 * 書類の提出で迷うのは「金額や口座番号まで写っていてよいのか」なので、文章ではなく
 * 隠し方そのものを図で見せる。中身は架空の帯だけで、実在の書類・事業者名は書かない。
 * 色は .theme-ecru の変数だけ（黒塗りは --ecru-text）。文字は 12px 未満にしない。
 */
const SHOW = ['店舗名', '所在地', '運営者'];
const HIDE = ['金額', '口座番号'];

export default function DocumentMaskIllustration({ className = '' }: { className?: string }) {
  return (
    <figure aria-label="書類の隠し方の見本（イメージ）" className={`grid items-center gap-5 sm:grid-cols-[minmax(0,240px)_1fr] ${className}`}>
      {/* 図そのものは飾り。何を見せて何を隠すかは右の一覧で伝える。 */}
      <div aria-hidden="true" className="mx-auto w-full max-w-[240px] rounded-md border border-(--ecru-line) bg-(--ecru-surface) p-4 shadow-sm">
        <div className="mb-3 h-3 w-1/3 rounded bg-(--ecru-muted)" />
        {SHOW.map(label => (
          <div key={label} className="mb-2 rounded border-2 border-(--ecru-accent) px-2 py-1">
            <span className="text-xs font-bold text-(--primary-dark)">{label}</span>
            <div className="mt-1 h-2 w-4/5 rounded bg-(--ecru-text)/60" />
          </div>
        ))}
        <div className="mt-3 space-y-2 border-t border-dashed border-(--ecru-line) pt-3">
          {HIDE.map(label => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--ecru-muted)">{label}</span>
              <div className="h-3 w-24 rounded-sm bg-(--ecru-text)" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-bold">写っていればよい所</p>
          <ul className="mt-2 space-y-1">{SHOW.map(item => <li key={item}>✓ {item}</li>)}</ul>
        </div>
        <div>
          <p className="font-bold">隠してよい所</p>
          <ul className="mt-2 space-y-1">{HIDE.map(item => <li key={item}>■ {item}</li>)}</ul>
        </div>
        <figcaption className="col-span-2 text-xs text-(--ecru-muted)">書類の隠し方の見本（イメージ）</figcaption>
      </div>
    </figure>
  );
}
