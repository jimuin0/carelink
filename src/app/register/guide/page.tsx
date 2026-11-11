import type { Metadata } from 'next';
import Link from 'next/link';
import RegistrationFlow from '@/components/register/RegistrationFlow';

/**
 * 掲載までの流れ（/register/guide）。文章で説明せず、図と短い見出しで見せる。
 * 手順そのものは RegistrationFlow（src/lib/registration-flow.ts）が単一ソース。
 * 色は .theme-ecru の変数だけを使う。
 */

const DOCUMENT_EXAMPLES = [
  { title: '開設届・営業許可', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9.5 15.5l1.5 1.5 3.5-3.5' },
  { title: '店舗の賃貸借契約書', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 12h6M9 15h6M9 18h3' },
  { title: '公共料金の請求書', icon: 'M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3ZM9 8h6M9 12h6M9 16h3' },
];

const LISTING_NEEDS = ['店舗名', '所在地', '曜日別の営業時間'];
const BOOKING_NEEDS = ['公開メニュー', '写真1枚以上', '勤務のあるスタッフ'];

function Icon({ d, className = 'h-7 w-7' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

const SHOP_ICON = 'M3 10h18M5 10v10h14V10M3 10l2-6h14l2 6M10 20v-5h4v5';
const ACCOUNT_ICON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0';

export const metadata: Metadata = {
  // ルート layout の title.template が「| CareLink」を付ける。
  title: '掲載までの流れ',
  description: '申込・アカウント作成・書類の提出・公開の4ステップと、提出できる書類の例。',
  alternates: { canonical: '/register/guide' },
};

/** <main> はレイアウト（LayoutSwitch）が持つので、ここでは置かない（二重になると landmark 違反）。 */
export default function RegistrationGuidePage() {
  return <div className="theme-ecru min-h-screen bg-(--ecru-bg) text-(--ecru-text)">
    <div className="section-container mx-auto max-w-3xl py-10 sm:py-14">
      <Link href="/register" className="text-sm underline underline-offset-4">掲載申込に戻る</Link>
      <h1 className="mt-6 font-(family-name:--font-serif-jp) text-2xl sm:text-3xl">掲載までの流れ</h1>

      <div className="mt-8 rounded-xl border border-(--ecru-line) bg-(--ecru-surface) px-2 py-6">
        <RegistrationFlow detailed />
      </div>

      <section className="mt-12" aria-labelledby="documents">
        <h2 id="documents" className="text-lg font-bold">STEP 3 の書類（どれか1点）</h2>
        <ul className="mt-4 grid grid-cols-3 gap-3">
          {DOCUMENT_EXAMPLES.map(doc => (
            <li key={doc.title} className="flex flex-col items-center gap-2 rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-4 text-center text-sm">
              <span className="text-(--ecru-accent)"><Icon d={doc.icon} className="h-9 w-9" /></span>
              {doc.title}
            </li>
          ))}
        </ul>
        <ul aria-label="ファイルの条件" className="mt-4 flex flex-wrap gap-2 text-sm">
          {['PDF・JPEG・PNG', '10MBまで', '金額や口座番号は隠してOK'].map(item => (
            <li key={item} className="rounded-full border border-(--ecru-line) bg-(--ecru-surface) px-3 py-1">{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-(--ecru-muted)">店舗名・所在地・運営者が分かる書類なら使えます。</p>
      </section>

      <section className="mt-12" aria-labelledby="listing-only">
        <h2 id="listing-only" className="text-lg font-bold">無料掲載とネット予約</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-4">
            <p className="font-bold">無料掲載</p>
            <ul className="mt-2 space-y-1 text-sm">{LISTING_NEEDS.map(item => <li key={item}>✓ {item}</li>)}</ul>
          </div>
          <div className="rounded-xl border border-dashed border-(--ecru-muted) bg-(--ecru-surface) p-4">
            <p className="font-bold">ネット予約（任意）</p>
            <p className="mt-1 text-xs text-(--ecru-muted)">無料掲載の項目に加えて</p>
            <ul className="mt-2 space-y-1 text-sm">{BOOKING_NEEDS.map(item => <li key={item}>＋ {item}</li>)}</ul>
          </div>
        </div>
        <p className="mt-3 text-sm text-(--ecru-muted)">申込だけで有料プランの契約にはなりません。</p>
      </section>

      <section className="mt-12" aria-labelledby="multiple-shops">
        <h2 id="multiple-shops" className="text-lg font-bold">複数の店舗</h2>
        <figure aria-label="1つのアカウントで複数店舗を管理" className="mt-4 rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-5">
          <div className="flex flex-col items-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--ecru-accent) text-white"><Icon d={ACCOUNT_ICON} className="h-6 w-6" /></span>
            <span className="mt-1 text-sm font-bold">1つのアカウント</span>
            <svg viewBox="0 0 240 28" aria-hidden="true" className="mt-1 h-7 w-60 text-(--ecru-muted)" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M120 0v10M40 10h160M40 10v18M120 10v18M200 10v18" />
            </svg>
            <ul className="grid w-full max-w-xs grid-cols-3 gap-2 text-center text-sm">
              {['店舗 A', '店舗 B', '店舗 C'].map(name => (
                <li key={name} className="flex flex-col items-center gap-1">
                  <span className="text-(--ecru-accent)"><Icon d={SHOP_ICON} /></span>{name}
                </li>
              ))}
            </ul>
          </div>
          <figcaption className="mt-4 text-center text-sm">申込は店舗ごと。管理は1つのアカウントで。</figcaption>
        </figure>
      </section>

      <p className="mt-12 text-sm">受付が分からないときは、申し込み直さずにご連絡ください。</p>
      <Link href="/contact" className="mt-2 inline-block underline underline-offset-4">運営に問い合わせる</Link>
    </div>
  </div>;
}
