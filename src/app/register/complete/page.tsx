import Link from 'next/link';
import { cookies } from 'next/headers';
import { SALON_CLAIM_COOKIE_NAME } from '@/lib/salon-claim';
import { resolveRegisteredSalon } from '@/lib/register-complete';
import { buildOnboardingAuthPath } from '@/lib/onboarding-link';
import RegistrationReceipt from '@/components/register/RegistrationReceipt';
import { businessTypeLabel } from '@/lib/business-type-label';
import { LISTING_PUBLISH_ITEMS, LISTING_PUBLISH_REQUIREMENT } from '@/lib/register-photo-policy';

/** /register と同じくすみ配色。色の値は globals.css の .theme-ecru だけが持つ。 */
const SHELL = 'theme-ecru min-h-[60vh] bg-(--ecru-bg) text-(--ecru-text)';

interface Props {
  searchParams: Promise<{ id?: string; handoff?: string }>;
}

export default async function RegisterCompletePage({ searchParams }: Props) {
  const { id, handoff } = await searchParams;
  if (handoff === 'registration') return <RegistrationReceipt />;
  const cookieStore = await cookies();
  const receipt = await resolveRegisteredSalon(id, cookieStore.get(SALON_CLAIM_COOKIE_NAME)?.value);
  if (receipt.status !== 'confirmed') {
    return (
      <div className={SHELL}>
        <div className="section-container">
          <div className="max-w-lg mx-auto text-center py-12">
            <h1 className="text-2xl font-bold mb-4">受付状況を確認できませんでした</h1>
            <p role="status" className="mb-4">
              {receipt.status === 'unavailable'
                ? '現在、受付情報の確認に時間がかかっています。'
                : 'この画面からは受付を確認できません。申込時のブラウザでご確認ください。'}
            </p>
            <p className="mb-6">登録済みの可能性があります。重複を避けるため再送信せず、受付状況をお問い合わせください。</p>
            <Link href="/contact" className="btn-primary">受付状況を問い合わせる</Link>
            <Link href="/register/recover" className="block mt-4 underline underline-offset-4">申込時のメールアドレスで送信済みの掲載申込を復旧</Link>
          </div>
        </div>
      </div>
    );
  }
  const { name, type, area } = receipt;

  return (
    <div className={SHELL}>
    <div className="section-container">
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-20 h-20 bg-(--ecru-accent) rounded-full flex items-center justify-center mx-auto mb-6" aria-hidden="true">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-4 font-(family-name:--font-serif-jp) text-2xl">登録が完了しました！</h1>
        <p className="text-sm mb-4">受付番号：<span className="break-all">{receipt.id}</span></p>
        <p className="text-sm mb-4">掲載申込の受付が完了しました。一般公開は、店舗情報の設定と公開操作の後に反映されます。</p>
        <p className="mb-2">
          あと少しで掲載開始できます。
        </p>
        <p className="text-sm text-(--ecru-muted) mb-8">
          アカウントを作成して、無料掲載を公開しましょう。{LISTING_PUBLISH_REQUIREMENT}ネット予約の設定は別に行います。
        </p>

        {(name || type || area) && (
          <div className="border border-(--ecru-line) bg-(--ecru-surface) p-6 mb-8 text-left">
            <h2 className="text-sm font-bold text-(--ecru-muted) mb-3">登録内容</h2>
            <dl className="space-y-2 text-sm">
              {name && (
                <div className="flex">
                  <dt className="w-20 text-(--ecru-muted) shrink-0">施設名</dt>
                  <dd className="font-medium">{name}</dd>
                </div>
              )}
              {type && (
                <div className="flex">
                  <dt className="w-20 text-(--ecru-muted) shrink-0">業種</dt>
                  <dd>{businessTypeLabel(type)}</dd>
                </div>
              )}
              {area && (
                <div className="flex">
                  <dt className="w-20 text-(--ecru-muted) shrink-0">所在地</dt>
                  <dd>{area}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* セットアップステップ */}
        <div className="border border-(--ecru-line) bg-(--ecru-surface) p-6 mb-8 text-left">
          <h2 className="text-sm font-bold mb-4">掲載までのステップ</h2>
          <ol className="space-y-3">
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-(--ecru-accent) text-white flex items-center justify-center text-xs font-bold shrink-0" aria-hidden="true">✓</span>
              <span className="text-sm text-(--ecru-muted)">施設情報を登録<span className="sr-only">（完了）</span></span>
            </li>
            <li className="flex items-center gap-3" aria-current="step">
              <span className="w-7 h-7 rounded-full border-2 border-(--ecru-accent) bg-(--ecru-surface) text-(--ecru-accent) flex items-center justify-center text-xs font-bold shrink-0" aria-hidden="true">2</span>
              <span className="text-sm font-medium">アカウント作成・ログイン</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full border border-(--ecru-line) bg-(--ecru-bg) text-(--ecru-muted) flex items-center justify-center text-xs font-bold shrink-0" aria-hidden="true">3</span>
              <span className="text-sm text-(--ecru-muted)">{LISTING_PUBLISH_ITEMS}を設定して掲載公開</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full border border-(--ecru-line) bg-(--ecru-bg) text-(--ecru-muted) flex items-center justify-center text-xs font-bold shrink-0" aria-hidden="true">4</span>
              <span className="text-sm text-(--ecru-muted)">公開して集客スタート！</span>
            </li>
          </ol>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href={buildOnboardingAuthPath('signup', { facilityName: name, businessType: type })}
            className="btn-primary px-8 py-4 text-base"
          >
            アカウントを作成して始める
          </Link>
          <Link
            href={buildOnboardingAuthPath('login', { facilityName: name, businessType: type })}
            className="text-sm underline underline-offset-4"
          >
            既にアカウントをお持ちの方はログイン
          </Link>
        </div>
      </div>
    </div>
    </div>
  );
}
