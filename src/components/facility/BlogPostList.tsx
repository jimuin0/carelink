import Link from 'next/link';
import type { BlogPostSummary } from '@/lib/blog';

interface Props {
  facilitySlug: string;
  posts: BlogPostSummary[];
  /** 公開記事の総数（posts は先頭の数件だけ） */
  total: number;
}

/** 公開日は日本時間で出す（サーバーの時刻帯で日付がずれないように）。 */
function publishedDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
}

/**
 * 施設ページの「ブログ」導線（2026年10月22日 新設）。
 * 店舗が公開した記事へ、施設ページから辿れる入口が 1 本も無かったため追加した。
 * 呼び出し側は公開記事が 1 本以上あるときだけ描画する。
 */
export default function BlogPostList({ facilitySlug, posts, total }: Props) {
  return (
    <div>
      <ul className="divide-y divide-gray-100 border-y border-gray-100">
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              href={`/facility/${facilitySlug}/blog/${post.slug}`}
              className="flex items-baseline justify-between gap-3 py-3 hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-800 line-clamp-2">{post.title}</span>
              <span className="text-xs text-gray-500 shrink-0">{publishedDate(post.published_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`/facility/${facilitySlug}/blog`}
        className="inline-flex items-center gap-1 text-sm text-sky-700 font-medium mt-3 hover:underline"
      >
        ブログ記事をすべて見る（{total}件）
      </Link>
    </div>
  );
}
