import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import type { BlogPost } from '@/types';

export default async function AdminBlogPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user!.id)
    .single();

  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', membership!.facility_id)
    .order('created_at', { ascending: false });

  const posts = (data ?? []) as BlogPost[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">ブログ管理</h1>
        <Link href="/admin/blog/new" className="btn-primary text-sm !py-2 !px-4">
          新規作成
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-3">ブログ記事がありません</p>
          <Link href="/admin/blog/new" className="text-sm text-primary hover:underline">
            最初の記事を書く
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/admin/blog/${post.id}/edit`}
              className="block bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{post.title}</p>
                  <p className="text-xs text-gray-400 mt-1">
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
