import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

export const metadata: Metadata = {
  title: '月額プラン',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface UserSubscription {
  id: string;
  status: string;
  sessions_used_this_month: number;
  month_reset_at: string;
  ends_at: string | null;
  created_at: string;
  subscription_plans: {
    name: string;
    price: number;
    sessions_per_month: number;
    description: string | null;
  } | null;
  facility_profiles: {
    name: string;
    slug: string;
  } | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active:    { label: '有効',      cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'キャンセル済み', cls: 'bg-red-100 text-red-700' },
  paused:    { label: '一時停止中', cls: 'bg-yellow-100 text-yellow-700' },
  expired:   { label: '期限切れ',  cls: 'bg-gray-100 text-gray-500' },
};

export default async function MySubscriptionsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await admin
    .from('user_subscriptions')
    .select('id, status, sessions_used_this_month, month_reset_at, ends_at, created_at, subscription_plans(name, price, sessions_per_month, description), facility_profiles(name, slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const subscriptions = (data ?? []) as unknown as UserSubscription[];
  const active = subscriptions.filter((s) => s.status === 'active' || s.status === 'paused');
  const inactive = subscriptions.filter((s) => s.status === 'cancelled' || s.status === 'expired');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">月額プラン</h1>
        <Link href="/mypage" className="text-sm text-gray-500 hover:underline">← マイページ</Link>
      </div>

      {subscriptions.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-sky-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-4">月額プランに加入していません</p>
          <Link href="/search" className="text-sm text-sky-600 hover:underline">施設を探して月額プランに申し込む</Link>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700">加入中のプラン</h2>
              {active.map((sub) => {
                const plan = sub.subscription_plans;
                const st = STATUS_LABEL[sub.status] ?? { label: sub.status, cls: 'bg-gray-100 text-gray-500' };
                const used = sub.sessions_used_this_month;
                const total = plan?.sessions_per_month ?? 1;
                const pct = Math.min(100, Math.round((used / total) * 100));
                const resetDate = new Date(sub.month_reset_at).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });

                return (
                  <div key={sub.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-gray-800">{plan?.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                        </div>
                        {sub.facility_profiles && (
                          <Link href={`/facility/${sub.facility_profiles.slug}`} className="text-xs text-sky-600 hover:underline">
                            {sub.facility_profiles.name}
                          </Link>
                        )}
                        {plan?.description && <p className="text-xs text-gray-400 mt-0.5">{plan.description}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-gray-800">¥{plan?.price.toLocaleString()}<span className="text-xs font-normal text-gray-400">/月</span></p>
                      </div>
                    </div>

                    {/* 今月の利用状況 */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>今月の利用: {used}/{total}回</span>
                        <span>{resetDate} にリセット</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className={`h-2 rounded-full transition-all ${pct >= 100 ? 'bg-red-400' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      {pct >= 100 && <p className="text-xs text-red-500 mt-1">今月の利用上限に達しました</p>}
                    </div>

                    {sub.ends_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        契約終了: {new Date(sub.ends_at).toLocaleDateString('ja-JP')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {inactive.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-gray-400">過去のプラン</h2>
              {inactive.map((sub) => {
                const st = STATUS_LABEL[sub.status] ?? { label: sub.status, cls: 'bg-gray-100 text-gray-500' };
                return (
                  <div key={sub.id} className="bg-gray-50 rounded-xl px-4 py-3 opacity-60">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">{sub.subscription_plans?.name}</p>
                        <p className="text-xs text-gray-400">{sub.facility_profiles?.name}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
