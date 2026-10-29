import type { CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import RegisterForm from '@/components/register/RegisterForm';
import { SHOW_JOBS } from '@/lib/feature-toggles';
import { LISTING_PUBLISH_ITEMS, LISTING_PUBLISH_REQUIREMENT, REGISTER_PHOTO_REQUIREMENT } from '@/lib/register-photo-policy';

/**
 * 店舗・施設向けの掲載ページ（/register）の本体。店舗向けの入口はこの 1 ページだけ
 * （旧 /salon・/salon/cases・/salon/demo は next.config.mjs で /register へ 308 転送。
 *  2026年10月23日 神原さん決定「店舗向けの見た目は くすみ系に統一し /salon を /register にまとめる。
 *  運営者の紹介・実際の掲載例は載せない」）。
 *
 * page.tsx は掲載エリア（DB の実在値）を取って渡すだけ。描画をここへ分けたのは、
 * 単体テストが DB を介さずにこの訴求部分とフォームを描けるようにするため。
 *
 * 🔴 見出しだけ明朝体にする（スマホ実機の見え方で判断）
 * 全面ゴシック＋濃い青＋影付きの白カードは、どう配置し直しても【業務システムの画面】に見える。
 * 日本の美容・サロン系で「上品」と受け取られる版面は、見出しが明朝、地色がアイボリー、
 * 文字がチャコール、区切りが影ではなく細い罫線、という構成になっている。
 * 本文はゴシックのまま（明朝は小さい字だと読みにくく、フォームの可読性を落とすため）。
 *
 * 【配色】globals.css の `.theme-ecru` が単一ソース。ここで色コードを直書きしない
 * （同じ色をヘッダー・フッターも使うため。src/__tests__/ecru-theme-single-source.test.ts）。
 *
 * 【文字の大きさ】12px（0.75rem）未満を使わない。以前は 10〜11px の見出し・表があり、
 * スマホで読めなかった（src/app/register/__tests__/pitch.test.tsx が直書きの小さい字を止める）。
 *
 * ⚠️ 数字と機能名は【実装にあるものだけ】を書く。盛った数字は景表法上の問題になるうえ、
 * 実態と違う約束は登録後の解約に直結する。
 */
const serifStyle = {
  '--font-serif-jp':
    '"Noto Serif JP Variable", "Yu Mincho", "Hiragino Mincho ProN", "Hiragino Mincho Pro", serif',
} as CSSProperties;

/** 主 CTA の文言。ヒーロー内と「掲載までの流れ」の後の 2 箇所で同じものを使う。 */
export const REGISTER_CTA_LABEL = '無料で掲載を申し込む';

/**
 * 有料プランについての約束。利用規約 第10条（src/app/terms/page.tsx）の
 * 「将来有料プランを設定する場合は事前に通知します」をそのまま言い換えたもの。
 * 規約に無いこと（例: 同意なしに課金しない）は書かない。
 */
export const PAID_PLAN_NOTICE = '将来、有料プランを設ける場合は、利用規約に基づき事前にお知らせします。';

/**
 * 現状（電話と紙の台帳）と CareLink の違い。競合サービスとの比較ではない。
 *
 * 🔴 「24時間」とだけ書かない。ネット予約は営業時間・メニュー等の設定が終わるまで使えない
 * （下の「お申し込み前のご確認」と同じ事実）。登録した瞬間から 24 時間受け付けると読める書き方は誤り。
 *
 * ⚠️ ここに載せてよいのは施設が管理画面から実際に使える機能だけ。LINE通知連携（LIFF 未設定で
 * 顧客が連携できない）・症状別検索（facility_symptoms へ書き込む管理 UI が無い）・
 * 保険適用メニュー対応（insurance_covered を書き込む管理 UI が無い）は、旧 /salon の比較表から
 * 落とした経緯がある。施設が管理画面から自分で設定でき、それが実際に届くようになるまで載せない。
 * src/__tests__/salon-comparison-claims.test.ts が書き込み経路の無い機能の追加を CI で止める。
 */
const COMPARISON: { label: string; before: string; after: string }[] = [
  { label: '予約の受付', before: '営業時間だけ', after: '設定後は24時間' },
  { label: '重複予約', before: '起こる', after: '防ぐ' },
  { label: '前日リマインド', before: '手作業', after: '自動' },
  { label: '口コミ', before: '集めて管理', after: '施設ページで対応' },
  { label: '掲載料・予約手数料', before: '—', after: '無料' },
];

/**
 * できること。
 *
 * ⚠️ ここに施術写真を敷かないこと。一度そうしたが、「顧客カルテ」にポートレート、
 * 「求人掲載」にオイルマッサージ、という【機能と中身が噛み合わない絵】になり、
 * かえって作りの粗さが目立った（実機のスクリーンショットで確認）。
 */
const CAPABILITIES: { title: string; body: string; icon: 'calendar' | 'card' | 'people' | 'list' }[] = [
  { title: 'ネット予約', body: '設定後は24時間、深夜でも受付', icon: 'calendar' },
  { title: '顧客カルテ', body: '来店履歴と好みを記録', icon: 'card' },
  // 求人は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
  // 提供していない機能を「できること」として約束しないよう、その間は実在するメニュー掲載を出す。
  SHOW_JOBS
    ? { title: '求人掲載', body: 'スタッフ募集も同じ画面から', icon: 'people' }
    : { title: 'メニュー掲載', body: 'メニューと料金を施設ページに', icon: 'list' },
];

const ICON_PATHS: Record<'calendar' | 'card' | 'people' | 'list', string> = {
  calendar: 'M8 2v3M16 2v3M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  card: 'M3 6h18v12H3zM7 10h4M7 14h7',
  people: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 20v-1a4 4 0 0 0-3-3.9M16.5 4.6a3 3 0 0 1 0 5.8',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
};

/** 番号は算用数字にする。ローマ数字（Ⅰ Ⅱ Ⅲ）も試したが、小サイズだと細い棒が並んで
 *  見え、何番か判読できなかった（実機のスクリーンショットで確認）。 */
const instantPublication = process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH === 'true';
const STEPS = [
  { n: '01', title: '基本情報を入力', body: '店舗名・業種・連絡先などを入力' },
  { n: '02', title: 'アカウントを作成', body: '登録内容を確認して管理画面へ進む' },
  { n: '03', title: instantPublication ? '掲載を開始' : '掲載を準備', body: instantPublication ? '申込時のメール確認とログイン後に無料掲載。ネット予約の設定は別に行います' : `${LISTING_PUBLISH_ITEMS}を設定して無料掲載を公開。ネット予約の設定は別に行います` },
];

/**
 * 主 CTA。16px 太字・高さ 52px（親指で確実に押せる大きさ）・くすみローズの塗り。
 * hover で透明にしない（写真の上では地が暗く、文字色のローズが読めなくなるため）。
 */
const CTA_CLASS =
  'inline-flex h-[52px] w-full items-center justify-center bg-(--ecru-accent) px-6 text-base font-bold tracking-[0.12em] text-white transition-colors hover:bg-(--primary-dark) sm:w-[320px]';

export default function RegisterLanding({ listingAreas = [] }: { listingAreas?: string[] }) {
  return (
    <div className="theme-ecru bg-(--ecru-bg) text-(--ecru-text)" style={serifStyle}>
      <div className="jp-wrap">
        {/* ===== ヒーロー =====
            写真の上に文字を重ねる編集誌的な組み。写真の下に文字を置く形も試したが、
            画像が「切り抜かれた飾り」に見えて安っぽかった（実機で確認）。

            🔴 スマホの最初の画面に申し込みボタンが入るよう、CTA はヒーローの中・見出しの下に置く。
            以前は CTA がヒーロー（高さ 68vh）の下にあり、スマホでは一度スクロールしないと
            何をすればよいページか分からなかった。高さは svh（アドレスバーを出した状態の高さ）で取る。 */}
        <section className="relative">
          <div className="relative min-h-[480px] h-[78svh] sm:h-[72svh] sm:min-h-[560px]">
            <Image
              src="/images/hero.webp"
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
            {/* 🔴 白文字の読みやすさは「覆いの濃さ」で決まる。写真が真っ白な最悪の画素でも
                白文字 4.5:1 以上を保つには、覆い（--ecru-scrim）を 75% 以上かける必要がある（計算値 5.81:1）。
                文字が載る下側 3/4 は 85%〜75% を保ち、写真を見せる上端だけ薄くする。
                globals.css の .theme-ecru の注記と同じ計算。 */}
            <div className="absolute inset-0 bg-linear-to-t from-(--ecru-scrim)/85 via-(--ecru-scrim)/75 via-75% to-(--ecru-scrim)/30" />

            <div className="absolute inset-x-0 bottom-0 px-7 pb-10 sm:px-12 sm:pb-14">
              <div className="mx-auto max-w-5xl">
                <p className="text-xs tracking-[0.3em] text-white">SALON &amp; CLINIC</p>
                <h1 className="mt-3 font-(family-name:--font-serif-jp) text-[1.875rem] font-normal leading-[1.5] tracking-[0.08em] text-white sm:text-5xl sm:leading-normal">
                  予約も、集客も、
                  <br />
                  ひとつに。
                </h1>
                <p className="mt-4 text-sm font-medium tracking-widest text-white sm:text-base">
                  掲載料・予約手数料 0円
                </p>
                {/* 掲載エリアは DB の実在値（公開中の施設の都道府県）。トップページの
                    「現在のご紹介エリア」と同じ取り方で、ハードコードしない（実態と必ずズレるため）。 */}
                {listingAreas.length > 0 && (
                  <p className="mt-1.5 text-sm text-white">
                    現在の主な掲載エリア：{listingAreas.join('・')}（順次拡大中）
                  </p>
                )}
                <a href="#register-form" className={`mt-6 ${CTA_CLASS}`}>
                  {REGISTER_CTA_LABEL}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 数字 ===== */}
        <section className="mt-14 px-7 sm:mt-20 sm:px-12">
          <dl className="mx-auto flex max-w-5xl border-y border-(--ecru-line)">
            {[
              { value: '0', unit: '円', label: '掲載料' },
              { value: '0', unit: '円', label: '予約手数料' },
              { value: '24', unit: 'h', label: 'ネット予約（設定後）' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-1 flex-col-reverse py-7 text-center ${i > 0 ? 'border-l border-(--ecru-line)' : ''}`}
              >
                {/* 読み上げは「掲載料 0円」の順（dt→dd）、見た目は数字を上に置く（flex-col-reverse）。 */}
                <dt className="mt-3 px-1 text-xs tracking-[0.12em] text-(--ecru-muted)">{stat.label}</dt>
                <dd className="font-(family-name:--font-serif-jp) text-[2rem] leading-none sm:text-[2.5rem]">
                  {stat.value}
                  <span className="ml-1 text-xs text-(--ecru-muted)">{stat.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mx-auto mt-4 max-w-5xl text-xs leading-relaxed text-(--ecru-muted)">
            ※ {PAID_PLAN_NOTICE}
          </p>
        </section>

        {/* ===== できること ===== */}
        <section className="mt-16 px-7 sm:mt-24 sm:px-12">
          <div className="mx-auto max-w-5xl">
            <div className="divide-y divide-(--ecru-line) border-y border-(--ecru-line) sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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
                    className="h-6 w-6 shrink-0 text-(--ecru-accent)"
                  >
                    <path d={ICON_PATHS[c.icon]} />
                  </svg>
                  <div>
                    <h2 className="text-sm tracking-widest">{c.title}</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-(--ecru-muted)">{c.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 比較 ===== */}
        <section className="mt-16 px-7 sm:mt-24 sm:px-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center font-(family-name:--font-serif-jp) text-lg tracking-[0.12em] sm:text-2xl">
              いまのやり方と、くらべると
            </h2>

            {/* div の格子ではなく table にする。比較表は行と列の対応そのものが情報なので、
                読み上げで「予約の受付／CareLink／設定後は24時間」と辿れる形にしておく必要がある。 */}
            <table className="mt-8 w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-(--ecru-text)">
                  <th scope="col" className="w-[34%] py-3">
                    <span className="sr-only">項目</span>
                  </th>
                  <th
                    scope="col"
                    className="py-3 text-center text-xs font-normal tracking-widest text-(--ecru-muted) sm:text-sm"
                  >
                    電話・紙
                  </th>
                  <th scope="col" className="py-3 text-center text-xs font-medium tracking-widest sm:text-sm">
                    CareLink
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b border-(--ecru-line)">
                    <th scope="row" className="py-4 pr-2 text-sm font-normal tracking-wide">
                      {row.label}
                    </th>
                    <td className="px-1 py-4 text-center text-[0.8125rem] text-(--ecru-muted) sm:text-sm">{row.before}</td>
                    <td className="px-1 py-4 text-center text-[0.8125rem] tracking-wide sm:text-sm">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== 流れ ===== */}
        <section className="mt-16 px-7 sm:mt-24 sm:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center font-(family-name:--font-serif-jp) text-lg tracking-[0.12em] sm:text-2xl">
              掲載までの流れ
            </h2>
            <ol className="mt-8 divide-y divide-(--ecru-line) border-y border-(--ecru-line) sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-baseline gap-5 py-6 sm:flex-col sm:gap-3 sm:px-7">
                  <span className="font-(family-name:--font-serif-jp) text-base text-(--ecru-muted)">
                    {s.n}
                  </span>
                  <div>
                    <p className="text-sm tracking-widest">{s.title}</p>
                    <p className="mt-1.5 text-sm text-(--ecru-muted)">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {/* 流れを読み終えた位置にも同じ申し込み導線を置く（ヒーローまで戻らせない）。 */}
            <div className="mt-10 flex justify-center">
              <a href="#register-form" className={CTA_CLASS}>
                {REGISTER_CTA_LABEL}
              </a>
            </div>
          </div>
        </section>

        <section aria-labelledby="registration-help" className="mt-16 px-7 sm:mt-24 sm:px-12">
          <div className="mx-auto max-w-3xl">
            <h2 id="registration-help" className="text-center font-(family-name:--font-serif-jp) text-lg sm:text-2xl">
              お申し込み前のご確認
            </h2>
            <dl className="mt-8 divide-y divide-(--ecru-line) border-y border-(--ecru-line) text-sm">
              <div className="py-5">
                <dt className="font-medium">この申し込みで料金は発生しますか？</dt>
                <dd className="mt-2 leading-relaxed">掲載料・予約手数料は無料です。この掲載申込で有料プランや決済契約を申し込むことはありません。{PAID_PLAN_NOTICE}</dd>
              </div>
              <div className="py-5">
                <dt className="font-medium">受付が完了したら、すぐに公開されますか？</dt>
                <dd className="mt-2 leading-relaxed">{instantPublication ? '申込に使ったメールアドレスを確認してログインすると掲載されます。申込時に所在地と曜日別営業時間を入力してください。' : <>受付完了と一般公開は別の手続きです。アカウントを作成し、管理画面で設定して掲載公開してください。{LISTING_PUBLISH_REQUIREMENT}</>}無料掲載にメニュー・スタッフの登録は必須ではありません。{REGISTER_PHOTO_REQUIREMENT}ネット予約はメニュー・スタッフ等の設定完了まで利用できません。</dd>
              </div>
              <div className="py-5">
                <dt className="font-medium">複数店舗はどのように登録しますか？</dt>
                <dd className="mt-2 leading-relaxed">店舗ごとに掲載申込が必要です。既に管理中の店舗があるアカウントで別の店舗を掲載する場合や、既存掲載の統合については登録前に運営へお問い合わせください。</dd>
              </div>
              <div className="py-5">
                <dt className="font-medium">送信後にエラーが出た場合、再送してよいですか？</dt>
                <dd className="mt-2 leading-relaxed">受付完了を確認できない場合は、重複を避けるため連続送信せず、画面に表示された確認方法に従ってください。解決しない場合は、店舗名と送信した日時を添えて運営へお問い合わせください。</dd>
              </div>
            </dl>
            <Link href="/contact" className="mt-5 inline-block underline underline-offset-4">施設掲載について運営に問い合わせる</Link>
          </div>
        </section>
      </div>

      {/* ===== フォーム ===== */}
      {/* 固定ヘッダー（h-16＝4rem）の下に見出しが隠れないよう、ヘッダーの高さ＋余白ぶん止める。 */}
      <section id="register-form" className="mt-20 scroll-mt-20 pb-24 sm:mt-28">
        <h2 className="mb-10 text-center font-(family-name:--font-serif-jp) text-lg tracking-[0.12em] sm:text-2xl">
          掲載のお申し込み
        </h2>
        <RegisterForm v2Enabled={true} />
      </section>
    </div>
  );
}
