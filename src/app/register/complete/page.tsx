import Link from 'next/link';
import { resolveRegisteredSalon } from '@/lib/register-complete';

interface Props {
  searchParams: Promise<{ id?: string }>;
}

export default async function RegisterCompletePage({ searchParams }: Props) {
  const { id } = await searchParams;
  const { name, type, area } = await resolveRegisteredSalon(id);

  return (
    <div className="section-container">
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-4">登録が完了しました！</h1>
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
            href={`/auth/signup?redirect=/admin/onboarding&facility_name=${encodeURIComponent(name)}&business_type=${encodeURIComponent(type)}`}
            className="btn-primary px-8 py-4 text-base"
          >
            アカウントを作成して始める
          </Link>
          <Link href="/auth/login?redirect=/admin/onboarding" className="text-sm text-sky-600 hover:underline">
            既にアカウントをお持ちの方はログイン
          </Link>
        </div>
      </div>
    </div>
  );
}
