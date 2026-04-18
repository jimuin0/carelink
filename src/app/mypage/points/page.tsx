import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import type { UserPoint } from '@/types';

export default async function PointsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data } = await supabase
    .from('user_points')
    .select('id, points, reason, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const points = (data ?? []) as UserPoint[];
  const totalPoints = points.reduce((sum, p) => sum + p.points, 0);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">ポイント履歴</h1>

      <div className="bg-primary text-white rounded-2xl p-6 mb-6">
        <p className="text-sm opacity-80">保有ポイント</p>
        <p className="text-3xl font-bold">{totalPoints.toLocaleString()} pt</p>
      </div>

      {points.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <p className="text-gray-400">ポイント履歴がありません</p>
          <p className="text-sm text-gray-400 mt-1">予約完了でポイントが貯まります</p>
        </div>
      ) : (
        <div className="space-y-2">
          {points.map((p) => (
            <div key={p.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{p.reason}</p>
                <p className="text-xs text-gray-400">
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
