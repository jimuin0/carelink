import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

export const metadata: Metadata = {
  title: '回数券・パッケージ',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface UserPackage {
  id: string;
  sessions_total: number;
  sessions_remaining: number;
  purchased_at: string;
  expires_at: string | null;
  service_packages: {
    name: string;
    description: string | null;
    price: number;
  } | null;
  facility_profiles: {
    name: string;
    slug: string;
  } | null;
}

export default async function MyPackagesPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await admin
    .from('user_packages')
    .select('id, sessions_total, sessions_remaining, purchased_at, expires_at, service_packages(name, description, price), facility_profiles(name, slug)')
    .eq('user_id', user.id)
    .order('purchased_at', { ascending: false });

  const packages = (data ?? []) as unknown as UserPackage[];
  const active = packages.filter((p) => p.sessions_remaining > 0 && (!p.expires_at || new Date(p.expires_at) > new Date()));
  const expired = packages.filter((p) => p.sessions_remaining === 0 || (p.expires_at && new Date(p.expires_at) <= new Date()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">回数券・パッケージ</h1>
        <Link href="/mypage" className="text-sm text-gray-500 hover:underline">← マイページ</Link>
      </div>

      {packages.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-sky-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-4">回数券・パッケージはありません</p>
          <Link href="/search" className="text-sm text-sky-600 hover:underline">施設を探して回数券を購入する</Link>
        </div>
      ) : (
        <>
          {/* 有効な回数券 */}
          {active.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700">利用可能な回数券</h2>
              {active.map((pkg) => {
                const usedCount = pkg.sessions_total - pkg.sessions_remaining;
                const pct = Math.round((usedCount / pkg.sessions_total) * 100);
                const isExpiringSoon = pkg.expires_at && new Date(pkg.expires_at) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                return (
                  <div key={pkg.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-gray-800">{pkg.service_packages?.name}</span>
                          {isExpiringSoon && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">まもなく期限切れ</span>
                          )}
                        </div>
                        {pkg.facility_profiles && (
                          <Link href={`/facility/${pkg.facility_profiles.slug}`} className="text-xs text-sky-600 hover:underline">
                            {pkg.facility_profiles.name}
                          </Link>
                        )}
                        {pkg.service_packages?.description && (
                          <p className="text-xs text-gray-400 mt-0.5">{pkg.service_packages.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-sky-600">{pkg.sessions_remaining}</p>
                        <p className="text-xs text-gray-400">/{pkg.sessions_total}回</p>
                      </div>
                    </div>

                    {/* 進捗バー */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>使用済み {usedCount}回</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="bg-sky-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    {pkg.expires_at && (
                      <p className={`text-xs mt-2 ${isExpiringSoon ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                        有効期限: {new Date(pkg.expires_at).toLocaleDateString('ja-JP')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 使い切り・期限切れ */}
          {expired.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-gray-400">使用済み・期限切れ</h2>
              {expired.map((pkg) => (
                <div key={pkg.id} className="bg-gray-50 rounded-xl px-4 py-3 opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">{pkg.service_packages?.name}</p>
                      <p className="text-xs text-gray-400">{pkg.facility_profiles?.name}</p>
                    </div>
                    <span className="text-xs text-gray-400">{pkg.sessions_total}回 完了</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
