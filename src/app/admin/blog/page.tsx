import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { loadAdminFacilitySelection } from '@/lib/admin-facility-selection';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { BlogPost } from '@/types';
import { SbPageHeader } from '@/components/admin/SbUi';

export default async function AdminBlogPage(props: { searchParams: Promise<{ facility_id?: string }> }) {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  // 複数店舗のオーナーは ?facility_id= で店舗を選ぶ（2026年10月22日）。以前は facility_members を
  // .limit(1) で 1 行だけ読み、2 店舗目のブログを一覧・作成・編集できず、新規作成は別の店舗へ公開されていた。
  const { facility_id: requested } = await props.searchParams;
  const { choices, selectedId: facilityId } = await loadAdminFacilitySelection(supabase, user.id, requested ?? null);
  if (choices.length === 0) notFound();
  const selector = <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/blog" />;
  if (!facilityId) return <div><SbPageHeader title="ブログ管理" />{selector}</div>;

  const { data } = await readPageResult(() => supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(100), '/admin/blog');

  const posts = (data ?? []) as BlogPost[];
  const newHref = `/admin/blog/new?facility_id=${facilityId}`;

  return (
    <div>
      {selector}
      <SbPageHeader title="ブログ管理" actions={
        <Link href={newHref} className="btn-primary text-sm py-2! px-4!">
          新規作成
        </Link>
      } />

      {posts.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-3">ブログ記事がありません</p>
          <Link href={newHref} className="text-sm text-primary hover:underline">
            最初の記事を書く
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/admin/blog/${post.id}/edit?facility_id=${facilityId}`}
              className="block bg-white rounded-xl p-4 shadow-xs hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{post.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {post.published_at ? new Date(post.published_at).toLocaleDateString('ja-JP') : '下書き'}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  post.is_published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {post.is_published ? '公開中' : '下書き'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
