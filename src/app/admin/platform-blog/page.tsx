import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PlatformPost {
  id: string;
  slug: string;
  title: string;
  category: string;
  is_published: boolean;
  published_at: string | null;
  updated_at: string;
}

export default async function PlatformBlogPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // プラットフォームブログはプラットフォーム管理者専用
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_platform_admin) notFound();

  const { data } = await supabase
    .from('platform_blog_posts')
    .select('id, slug, title, category, is_published, published_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  const posts = (data ?? []) as PlatformPost[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">プラットフォームブログ</h1>
          <p className="text-xs text-gray-400 mt-0.5">CareLink 公式コラム記事の管理</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/blog" target="_blank" rel="noopener noreferrer" className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            公開ページ →
          </Link>
          <Link href="/admin/platform-blog/new" className="text-sm px-4 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium">
            新規作成
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {posts.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="mb-2">記事がありません</p>
            <Link href="/admin/platform-blog/new" className="text-sm text-sky-600 hover:underline">最初の記事を作成する</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">タイトル</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">カテゴリ</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">最終更新</th>
                <th className="text-left px-4 py-3 font-medium">ステータス</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 truncate max-w-xs">{post.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{post.slug}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{post.category}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                    {new Date(post.updated_at).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      post.is_published ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {post.is_published ? '公開中' : '下書き'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {post.is_published && (
                        <Link href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-sky-600">
                          表示
                        </Link>
                      )}
                      <Link href={`/admin/platform-blog/${post.id}/edit`} className="text-xs text-sky-600 hover:underline font-medium">
                        編集
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
