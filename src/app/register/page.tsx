import type { Metadata } from 'next';
import Image from 'next/image';
import RegisterForm from '@/components/register/RegisterForm';

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
  { n: '01', title: '無料登録', body: 'このページで3分' },
  { n: '02', title: 'アカウント作成', body: '入力内容がそのまま反映' },
  { n: '03', title: '掲載開始', body: 'その日から予約を受付' },
];

export default function RegisterPage() {
  return (
    <div className="bg-[#FBF9F7]">
      {/* ===== ヒーロー ===== */}
      <section>
        <div className="relative h-[46vw] min-h-[220px] max-h-[380px] sm:h-[320px]">
          <Image
            src="/images/hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* 下端を背景色へ溶かす。文字を画像に重ねないので読みづらさが出ない。 */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#FBF9F7]" />
        </div>

        <div className="relative -mt-8 px-6 text-center">
          <p className="text-[11px] tracking-[0.2em] text-gray-500">SALON &amp; CLINIC</p>
          <h1 className="mt-3 text-[26px] sm:text-4xl font-medium leading-[1.5] tracking-wide text-gray-900">
            予約も、集客も、
            <br />
            ひとつに。
          </h1>
          <p className="mt-4 text-sm text-gray-500">掲載料0円 · 最短3分</p>

          <a
            href="#register-form"
            className="mt-7 inline-flex h-12 w-full max-w-[280px] items-center justify-center rounded-full bg-primary text-sm font-bold text-white transition-transform active:scale-95"
          >
            無料ではじめる
          </a>
        </div>
      </section>

      {/* ===== 数字 ===== */}
      <section className="mt-12 px-6">
        <dl className="mx-auto flex max-w-md items-stretch justify-between rounded-3xl bg-white px-2 py-6 shadow-[0_2px_24px_rgba(0,0,0,0.04)]">
          {[
            { value: '0', unit: '円', label: '掲載料' },
            { value: '3', unit: '分', label: '登録' },
            { value: '24', unit: '時間', label: '予約受付' },
          ].map((stat, i) => (
            <div key={stat.label} className="flex flex-1 items-center justify-center">
              {i > 0 && <div className="mr-auto h-8 w-px bg-gray-100" />}
              <div className="text-center">
                <dd className="text-[28px] font-medium leading-none text-gray-900">
                  {stat.value}
                  <span className="ml-0.5 text-xs text-gray-400">{stat.unit}</span>
                </dd>
                <dt className="mt-2 text-[11px] tracking-wider text-gray-400">{stat.label}</dt>
              </div>
              {i > 0 && <div className="ml-auto" />}
            </div>
          ))}
        </dl>
      </section>

      {/* ===== できること ===== */}
      <section className="mt-14 px-6">
        <div className="mx-auto max-w-md space-y-3 sm:max-w-3xl sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
          {CAPABILITIES.map((c) => (
            <article
              key={c.title}
              className="flex items-center gap-4 rounded-3xl bg-white px-5 py-4 sm:flex-col sm:items-start sm:gap-3 sm:py-6"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-7 w-7 shrink-0 text-primary/70"
              >
                <path d={ICON_PATHS[c.icon]} />
              </svg>
              <div>
                <h2 className="text-sm font-bold tracking-wide text-gray-900">{c.title}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{c.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ===== 比較 ===== */}
      <section className="mt-14 px-6">
        <div className="mx-auto max-w-md sm:max-w-2xl">
          <h2 className="text-center text-base font-medium tracking-wide text-gray-900">
            いまのやり方と、くらべると
          </h2>

          {/* div の格子ではなく table にする。比較表は行と列の対応そのものが情報なので、
              読み上げで「予約の受付／CareLink／24時間」と辿れる形にしておく必要がある。 */}
          <table className="mt-6 w-full table-fixed overflow-hidden rounded-3xl bg-white text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th scope="col" className="w-[38%] px-5 py-3">
                  <span className="sr-only">項目</span>
                </th>
                <th scope="col" className="px-2 py-3 text-center text-[11px] font-normal text-gray-400">
                  電話・紙
                </th>
                <th scope="col" className="px-2 py-3 text-center text-[11px] font-bold text-primary">
                  CareLink
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-b border-gray-50 last:border-b-0">
                  <th scope="row" className="px-5 py-3.5 text-xs font-medium text-gray-700">
                    {row.label}
                  </th>
                  <td className="px-2 py-3.5 text-center text-[11px] text-gray-400">{row.before}</td>
                  <td className="px-2 py-3.5 text-center text-[11px] font-bold text-gray-900">
                    {row.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== 流れ ===== */}
      <section className="mt-14 px-6">
        <div className="mx-auto max-w-md sm:max-w-3xl">
          <h2 className="text-center text-base font-medium tracking-wide text-gray-900">
            掲載までの流れ
          </h2>
          <ol className="mt-6 space-y-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-center gap-4 rounded-3xl bg-white px-5 py-4 sm:flex-col sm:items-start">
                <span className="text-lg font-medium tracking-widest text-primary/40">{s.n}</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">{s.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ===== フォーム ===== */}
      <section id="register-form" className="mt-16 scroll-mt-4 pb-16">
        <h2 className="mb-6 text-center text-base font-medium tracking-wide text-gray-900">
          掲載のお申し込み
        </h2>
        <RegisterForm />
      </section>
    </div>
  );
}
