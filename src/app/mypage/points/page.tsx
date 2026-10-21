import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import type { UserPoint } from '@/types';
import { readPointsBalance } from '@/lib/points-balance';

export default async function PointsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable title="マイページのログイン状態を確認できません" />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  let points: UserPoint[];
  let totalPoints: number;
  try {
    const [history, balance] = await Promise.all([
      supabase.from('user_points').select('id, points, reason, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      readPointsBalance(supabase, user.id),
    ]);
    if (history.error || !history.data) throw new Error('POINTS_HISTORY_UNAVAILABLE');
    points = history.data as UserPoint[];
    totalPoints = balance;
  } catch {
    return (
      <div role="alert">
        <h1 className="text-xl font-bold mb-4">ポイント履歴</h1>
        <p>ポイントを取得できませんでした。</p>
        <form action="/mypage/points" method="get">
          <button type="submit" className="text-primary underline">再読み込み</button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">ポイント履歴</h1>
      <p className="text-sm text-gray-500 mb-4">残高は全履歴の合計です。履歴は直近50件を表示します。</p>

      <div className="bg-primary text-white rounded-2xl p-6 mb-6">
        <p className="text-sm opacity-80">保有ポイント</p>
        <p className="text-3xl font-bold">{totalPoints.toLocaleString()} pt</p>
      </div>

      {points.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xs p-8 text-center">
          <p className="text-gray-500">ポイント履歴がありません</p>
          <p className="text-sm text-gray-500 mt-1">予約完了でポイントが貯まります</p>
        </div>
      ) : (
        <div className="space-y-2">
          {points.map((p) => (
            <div key={p.id} className="bg-white rounded-xl shadow-xs p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{p.reason}</p>
                <p className="text-xs text-gray-500">
                  {new Date(p.created_at).toLocaleDateString('ja-JP')}
                </p>
              </div>
              <p className={`font-bold ${p.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {p.points > 0 ? '+' : ''}{p.points} pt
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
