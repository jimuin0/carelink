import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Image from 'next/image';
import { Noto_Serif_JP } from 'next/font/google';
import RegisterForm from '@/components/register/RegisterForm';

/**
 * 見出しだけ明朝体にする。
 *
 * 🔴 なぜ書体を足すか（スマホ実機の見え方で判断）
 * 全面ゴシック（Noto Sans JP）＋濃い青＋影付きの白カード、という組み合わせは、
 * どう配置し直しても【業務システムの画面】に見える。日本の美容・サロン系で
 * 「上品」と受け取られる版面は、見出しが明朝、地色がアイボリー、文字がチャコール、
 * 区切りが影ではなく細い罫線、という構成になっている。好みの問題ではなく様式の問題なので、
 * 余白や配置を微調整するより先に、この 3 つ（書体・配色・罫線）を変える。
 *
 * 本文はゴシックのまま残す（明朝は小さい字だと読みにくく、フォームの可読性を落とすため）。
 * このページでしか使わないので、next/font がこのルートにだけ配信する。
 */
const serif = Noto_Serif_JP({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-serif-jp',
});

export const metadata: Metadata = {
  title: '無料掲載登録 | CareLink',
  description: '掲載料0円。ネット予約・顧客管理・求人掲載までひとつに。最短3分で登録できます。',
};

/**
 * 施設向けの掲載登録ページ。
 *
 * 🔴 なぜサーバーコンポーネントに分けたか
 * 旧実装はページ全体が 'use client' の巨大なフォーム 1 本で、見出しと 1 行の説明の下が
 * いきなり 20 項目超の入力欄だった。スマホでは【文字だけが延々と続く画面】になり、
 * 「なぜ登録するのか」が一切伝わらないまま離脱する構造だった。
 * 訴求部分は静的なので、サーバー側で描いてクライアント JS を増やさない。
 * フォームだけが 'use client'（src/components/register/RegisterForm.tsx）。
 *
 * ⚠️ 数字と機能名は【実装にあるものだけ】を書く。盛った数字は景表法上の問題になるうえ、
 * 実態と違う約束は登録後の解約に直結する。競合との価格比較を載せるなら根拠資料が要る。
 */

/** 現状（電話と紙の台帳）と CareLink の違い。競合サービスとの比較ではない。 */
const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: '予約の受付', before: '営業時間だけ', after: '24時間' },
  { label: '重複予約', before: '起こる', after: '防ぐ' },
  { label: '前日リマインド', before: '手作業', after: '自動' },
  { label: '口コミ', before: '集まらない', after: '自動でお願い' },
  { label: '初期費用', before: '—', after: '0円' },
];

/**
 * できること。
 *
 * ⚠️ ここに施術写真を敷かないこと。一度そうしたが、「顧客カルテ」にポートレート、
 * 「求人掲載」にオイルマッサージ、という【機能と中身が噛み合わない絵】になり、
 * かえって作りの粗さが目立った（実機のスクリーンショットで確認）。
 * 実画面のスクリーンショットが用意できるまでは、線画アイコンで揃えるほうが上質に見える。
 */
const CAPABILITIES: { title: string; body: string; icon: 'calendar' | 'card' | 'people' }[] = [
  { title: 'ネット予約', body: '深夜でも予約が入る', icon: 'calendar' },
  { title: '顧客カルテ', body: '来店履歴と好みを記録', icon: 'card' },
  { title: '求人掲載', body: 'スタッフ募集も同じ画面から', icon: 'people' },
];

const ICON_PATHS: Record<'calendar' | 'card' | 'people', string> = {
  calendar: 'M8 2v3M16 2v3M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  card: 'M3 6h18v12H3zM7 10h4M7 14h7',
  people: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 20v-1a4 4 0 0 0-3-3.9M16.5 4.6a3 3 0 0 1 0 5.8',
};

const STEPS = [
  { n: 'Ⅰ', title: '無料登録', body: 'このページで3分' },
  { n: 'Ⅱ', title: 'アカウント作成', body: '入力内容がそのまま反映' },
  { n: 'Ⅲ', title: '掲載開始', body: 'その日から予約を受付' },
];

export default function RegisterPage() {
  return (
    <div
      className={`${serif.variable} bg-[#FAF7F2] text-[#2E2A26]`}
      /* 🔴 このページの中だけブランド色を差し替える。
         .btn-primary / StepIndicator / focus リングはいずれも var(--primary) を参照しているので、
         変数を 1 箇所で上書きすればフォーム側も同じ色に揃う（個々のボタンへ !important を
         撒くと、disabled の灰色まで潰してしまう）。
         濃い青のままだと、明朝＋アイボリーの面に対してボタンだけが医療系の配色で浮く。
         ヘッダー・フッターはこの div の外なので、サイト全体のブランド色は変えていない。 */
      style={{ '--primary': '#2E2A26', '--primary-dark': '#161310' } as CSSProperties}
    >
      {/* ===== ヒーロー =====
          写真の上に文字を重ねる編集誌的な組み。写真の下に文字を置く形も試したが、
          画像が「切り抜かれた飾り」に見えて安っぽかった（実機で確認）。 */}
      <section className="relative">
        <div className="relative h-[68vh] min-h-[420px] sm:h-[72vh] sm:min-h-[520px]">
          <Image
            src="/images/hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* 文字を置く下半分だけを沈める。全面に暗幕をかけると写真が死ぬ。 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 px-7 pb-12 sm:px-12 sm:pb-16">
            <div className="mx-auto max-w-5xl">
              <p className="text-[10px] tracking-[0.35em] text-white/70">SALON &amp; CLINIC</p>
              <h1 className="mt-4 font-[family-name:var(--font-serif-jp)] text-[30px] font-normal leading-[1.6] tracking-[0.08em] text-white sm:text-5xl sm:leading-[1.5]">
                予約も、集客も、
                <br />
                ひとつに。
              </h1>
              <p className="mt-5 text-xs tracking-widest text-white/80 sm:text-sm">
                掲載料 0円 ／ 最短 3分
              </p>
            </div>
          </div>
        </div>

        <div className="px-7 sm:px-12">
          <div className="mx-auto max-w-5xl">
            <a
              href="#register-form"
              className="mt-8 inline-flex h-14 w-full items-center justify-center border border-[#2E2A26] bg-[#2E2A26] text-xs font-medium tracking-[0.2em] text-white transition-colors hover:bg-transparent hover:text-[#2E2A26] sm:w-[280px]"
            >
              無料ではじめる
            </a>
          </div>
        </div>
      </section>

      {/* ===== 数字 ===== */}
      <section className="mt-14 px-7 sm:mt-20 sm:px-12">
        <dl className="mx-auto flex max-w-5xl border-y border-[#E4DCD1]">
          {[
            { value: '0', unit: '円', label: '掲載料' },
            { value: '3', unit: '分', label: '登録' },
            { value: '24', unit: 'h', label: '予約受付' },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`flex-1 py-7 text-center ${i > 0 ? 'border-l border-[#E4DCD1]' : ''}`}
            >
              <dd className="font-[family-name:var(--font-serif-jp)] text-[32px] leading-none sm:text-[40px]">
                {stat.value}
                <span className="ml-1 text-xs text-[#9C9287]">{stat.unit}</span>
              </dd>
              <dt className="mt-3 text-[10px] tracking-[0.2em] text-[#9C9287]">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ===== できること ===== */}
      <section className="mt-16 px-7 sm:mt-24 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <div className="divide-y divide-[#E4DCD1] border-y border-[#E4DCD1] sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {CAPABILITIES.map((c) => (
              <article
                key={c.title}
                className="flex items-center gap-5 py-6 sm:flex-col sm:items-start sm:gap-4 sm:px-7"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-6 w-6 shrink-0 text-[#8C8378]"
                >
                  <path d={ICON_PATHS[c.icon]} />
                </svg>
                <div>
                  <h2 className="text-[13px] tracking-[0.1em]">{c.title}</h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#9C9287]">{c.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 比較 ===== */}
      <section className="mt-16 px-7 sm:mt-24 sm:px-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-[family-name:var(--font-serif-jp)] text-lg tracking-[0.12em] sm:text-2xl">
            いまのやり方と、くらべると
          </h2>

          {/* div の格子ではなく table にする。比較表は行と列の対応そのものが情報なので、
              読み上げで「予約の受付／CareLink／24時間」と辿れる形にしておく必要がある。 */}
          <table className="mt-8 w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-[#2E2A26]">
                <th scope="col" className="w-[36%] py-3">
                  <span className="sr-only">項目</span>
                </th>
                <th
                  scope="col"
                  className="py-3 text-center text-[10px] font-normal tracking-[0.1em] text-[#9C9287]"
                >
                  電話・紙
                </th>
                <th scope="col" className="py-3 text-center text-[10px] font-medium tracking-[0.1em]">
                  CareLink
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-b border-[#E4DCD1]">
                  <th scope="row" className="py-4 text-xs font-normal tracking-wide">
                    {row.label}
                  </th>
                  <td className="py-4 text-center text-[11px] text-[#B5ABA0]">{row.before}</td>
                  <td className="py-4 text-center text-[11px] tracking-wide">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== 流れ ===== */}
      <section className="mt-16 px-7 sm:mt-24 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-[family-name:var(--font-serif-jp)] text-lg tracking-[0.12em] sm:text-2xl">
            掲載までの流れ
          </h2>
          <ol className="mt-8 divide-y divide-[#E4DCD1] border-y border-[#E4DCD1] sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-baseline gap-5 py-6 sm:flex-col sm:gap-3 sm:px-7">
                <span className="font-[family-name:var(--font-serif-jp)] text-base text-[#B5ABA0]">
                  {s.n}
                </span>
                <div>
                  <p className="text-[13px] tracking-[0.1em]">{s.title}</p>
                  <p className="mt-1.5 text-xs text-[#9C9287]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ===== フォーム ===== */}
      <section id="register-form" className="mt-20 scroll-mt-4 pb-24 sm:mt-28">
        <h2 className="mb-10 text-center font-[family-name:var(--font-serif-jp)] text-lg tracking-[0.12em] sm:text-2xl">
          掲載のお申し込み
        </h2>
        <RegisterForm />
      </section>
    </div>
  );
}
