import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import type { FacilityJob } from '@/lib/jobs';
import { SbPageHeader } from '@/components/admin/SbUi';

export const dynamic = 'force-dynamic';

export const metadata = { title: '求人管理' };

export default async function AdminJobsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login?redirect=/admin/jobs');

  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  const facilityIds = (memberships ?? []).map((m) => m.facility_id);
  if (facilityIds.length === 0) {
    return (
      <div>
        <SbPageHeader title="求人管理" />
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">管理可能な施設がありません</div>
      </div>
    );
  }

  // メンバーシップ検証後の facility_jobs read は service role で行う（API ルート POST/GET と同型）。
  // facility_jobs の RLS は「published 施設の公開 read」のみで、未公開施設のオーナーは auth
  // クライアントでは自店の求人を読めず一覧が空になる（自店管理が機能しない実バグ）ため。
  const admin = createServiceRoleClient();
  const { data: jobs } = await admin
    .from('facility_jobs')
    .select('id, facility_id, title, job_type, employment_type, salary_min, salary_max, created_at, updated_at, salary_note, description, requirements, benefits')
    .in('facility_id', facilityIds)
    .order('created_at', { ascending: false });

  const list = (jobs ?? []) as FacilityJob[];

  return (
    <div>
      <SbPageHeader title="求人管理" actions={
        <Link href="/admin/jobs/new" className="btn-primary text-sm !py-2 !px-4">新規作成</Link>
      } />

      {list.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-3">求人がありません</p>
          <Link href="/admin/jobs/new" className="text-sm text-primary hover:underline">最初の求人を作成</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((job) => (
            <div key={job.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="inline-block text-micro px-2 py-0.5 rounded bg-sky-50 text-primary">
                      {job.employment_type}
                    </span>
                    <span className="inline-block text-micro px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                      {job.job_type}
                    </span>
                    <span className="text-micro text-gray-400">
                      {new Date(job.created_at).toLocaleDateString('ja-JP')}
                    </span>
                  </div>
                  <p className="font-bold truncate">{job.title}</p>
                  {(job.salary_min || job.salary_max) && (
                    <p className="text-sm text-gray-500 mt-1">
                      給与：
                      {job.salary_min ? `¥${job.salary_min.toLocaleString()}` : ''}
                      {job.salary_min && job.salary_max ? ' 〜 ' : job.salary_max ? '〜' : ''}
                      {job.salary_max ? `¥${job.salary_max.toLocaleString()}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Link
                    href={`/admin/jobs/${job.id}/edit`}
                    className="text-xs text-primary hover:underline"
                  >
                    編集
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
