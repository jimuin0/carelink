import Link from 'next/link';
import Button from '@/components/ui/Button';
import { cookies } from 'next/headers';
import { SALON_CLAIM_COOKIE_NAME } from '@/lib/salon-claim';
import { resolveRegisteredSalon } from '@/lib/register-complete';
import { buildOnboardingAuthPath } from '@/lib/onboarding-link';
import RegistrationReceipt from '@/components/register/RegistrationReceipt';
import ConfirmedReceipt from '@/components/register/ConfirmedReceipt';

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
            <p className="mb-6">受付済みの可能性があります。重複を避けるため再送信せず、受付状況をお問い合わせください。</p>
            <Button href="/contact" prefetch="auto">受付状況を問い合わせる</Button>
            <Link href="/register/recover" className="block mt-4 underline underline-offset-4">掲載申込の続きへ進む</Link>
          </div>
        </div>
      </div>
    );
  }
  const { name, type, area } = receipt;

  return <div className={SHELL}>
    <ConfirmedReceipt id={receipt.id} name={name} type={type} area={area}
      signupHref={buildOnboardingAuthPath('signup', { facilityName: name, businessType: type })}
      loginHref={buildOnboardingAuthPath('login', { facilityName: name, businessType: type })} />
  </div>;
}
