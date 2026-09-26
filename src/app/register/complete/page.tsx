import Link from 'next/link';
import { cookies } from 'next/headers';
import { SALON_CLAIM_COOKIE_NAME } from '@/lib/salon-claim';
import { resolveRegisteredSalon } from '@/lib/register-complete';
import { buildOnboardingAuthPath } from '@/lib/onboarding-link';
import RegistrationReceipt from '@/components/register/RegistrationReceipt';

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
        </div>
      </div>
    );
  }
  const { name, type, area } = receipt;

  return (
    <div className="section-container">
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-4">登録が完了しました！</h1>
        <p className="text-sm mb-4">受付番号：<span className="break-all">{receipt.id}</span></p>
        <p className="text-sm mb-4">掲載申込の受付が完了しました。一般公開は、店舗情報の設定と公開操作の後に反映されます。</p>
        <p className="text-gray-600 mb-2">
          あと少しで掲載開始できます。
        </p>
        <p className="text-sm text-gray-500 mb-8">
          アカウントを作成して、メニュー・スタッフ・写真を登録しましょう。
        </p>

        {(name || type || area) && (
          <div className="bg-gray-50 rounded-xl p-6 mb-8 text-left">
            <h2 className="text-sm font-bold text-gray-500 mb-3">登録内容</h2>
            <dl className="space-y-2 text-sm">
              {name && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">施設名</dt>
                  <dd className="font-medium">{name}</dd>
                </div>
              )}
              {type && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">業種</dt>
                  <dd>{type}</dd>
                </div>
              )}
              {area && (
                <div className="flex">
                  <dt className="w-20 text-gray-500 flex-shrink-0">所在地</dt>
                  <dd>{area}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* セットアップステップ */}
        <div className="bg-sky-50 rounded-xl p-6 mb-8 text-left">
          <h2 className="text-sm font-bold text-sky-800 mb-4">掲載までのステップ</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold shrink-0">✓</div>
              <span className="text-sm text-gray-600">施設情報を登録</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
              <span className="text-sm font-medium text-gray-800">アカウント作成・ログイン</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-xs font-bold shrink-0">3</div>
              <span className="text-sm text-gray-500">メニュー・スタッフ・写真を追加</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-xs font-bold shrink-0">4</div>
              <span className="text-sm text-gray-500">公開して集客スタート！</span>
            </div>
          </div>
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
            className="text-sm text-sky-600 hover:underline"
          >
            既にアカウントをお持ちの方はログイン
          </Link>
        </div>
      </div>
    </div>
  );
}
