import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { SITE_URL } from '@/lib/constants';
import { SHOW_JOBS } from '@/lib/feature-toggles';

export const revalidate = 1800;

const PAGE_SIZE = 30;

interface SearchParams {
  job_type?: string;
  prefecture?: string;
  page?: string;
}

interface JobListRow {
  id: string;
  title: string;
  job_type: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_note: string | null;
  created_at: string;
  facility_profiles: {
    name: string;
    slug: string;
    prefecture: string;
    city: string;
    main_photo_url: string | null;
    status: string;
  } | null;
}

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  title: '求人一覧',
  description: '医療・福祉・美容の求人をCareLinkで探す。職種・都道府県で絞り込み可能。',
  alternates: { canonical: `${SITE_URL}/jobs` },
  // SHOW_JOBS=false の間は検索エンジンへの新規露出のみ止める（直URLアクセス・ページ自体は温存）。
  // src/lib/feature-toggles.ts 参照・true に戻すだけで復活。
  ...(SHOW_JOBS ? {} : { robots: { index: false, follow: false } }),
};

export default async function JobsListPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const supabase = createServerSupabaseClient();
  const parsedPage = parseInt(searchParams.page || '1', 10);
  const page = Math.max(1, Number.isNaN(parsedPage) ? 1 : parsedPage);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('facility_jobs')
    .select(
      `id, title, job_type, employment_type, salary_min, salary_max, salary_note, created_at,
       facility_profiles!inner ( name, slug, prefecture, city, main_photo_url, status )`,
      { count: 'exact' }
    )
    .eq('facility_profiles.status', 'published')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (searchParams.job_type) query = query.eq('job_type', searchParams.job_type);
  if (searchParams.prefecture) query = query.eq('facility_profiles.prefecture', searchParams.prefecture);

  const { data, count, error } = await query;
  if (error) {
    // 監査T4: 従来は error を destructure せず破棄しており、クエリ失敗(RLS/PostgRESTエラー)時も
    // 空配列→「求人がありません」を正常表示としてしまい、エラーとゼロ件が区別できなかった。
    // ログを残し、下の空状態表示でエラーを明示する。
    console.error('[jobs] 求人一覧の取得に失敗', { err: error.message });
  }
  const jobs = (data || []) as unknown as JobListRow[];
  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (searchParams.job_type) params.set('job_type', searchParams.job_type);
    if (searchParams.prefecture) params.set('prefecture', searchParams.prefecture);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `/jobs?${qs}` : '/jobs';
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <div className="px-4 sm:px-6 py-6 border-b border-gray-100">
          <h1 className="text-2xl font-bold mb-2">求人一覧</h1>
          <p className="text-sm text-gray-500">医療・福祉・美容業界の求人 {total}件</p>
        </div>

        {/* フィルタ */}
        <form method="GET" className="px-4 sm:px-6 py-4 border-b border-gray-100 flex flex-wrap gap-3">
          <select
            name="job_type"
            aria-label="職種で絞り込む"
            defaultValue={searchParams.job_type || ''}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2"
          >
            <option value="">すべての職種</option>
            <option value="美容師">美容師</option>
            <option value="看護師">看護師</option>
            <option value="介護士">介護士</option>
            <option value="鍼灸師">鍼灸師</option>
            <option value="柔道整復師">柔道整復師</option>
          </select>
          <select
            name="prefecture"
            aria-label="都道府県で絞り込む"
            defaultValue={searchParams.prefecture || ''}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2"
          >
            <option value="">すべての都道府県</option>
            {['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '北海道', '京都府', '兵庫県', '埼玉県', '千葉県'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button type="submit" className="text-sm bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg font-medium">
            絞り込む
          </button>
        </form>

        {/* リスト */}
        <div className="divide-y divide-gray-100">
          {jobs.length === 0 && (
            <div className="px-4 sm:px-6 py-12 text-center text-gray-500 text-sm">
              {error ? '求人情報の読み込みに失敗しました。時間をおいて再度お試しください。' : '該当する求人がありません'}
            </div>
          )}
          {jobs.map((j) => {
            const f = j.facility_profiles;
            if (!f) return null;
            const salary =
              j.salary_min && j.salary_max
                ? `¥${j.salary_min.toLocaleString()}〜¥${j.salary_max.toLocaleString()}`
                : j.salary_min
                ? `¥${j.salary_min.toLocaleString()}〜`
                : j.salary_note || '応相談';
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex gap-4">
                  {f.main_photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    (<img src={f.main_photo_url} alt={f.name} className="w-16 h-16 object-cover rounded-lg shrink-0" />)
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded font-medium">{j.job_type}</span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">{j.employment_type}</span>
                    </div>
                    <h2 className="text-sm font-bold mb-1 line-clamp-2">{j.title}</h2>
                    <p className="text-xs text-gray-500 mb-1">{f.name} ／ {f.prefecture}{f.city}</p>
                    <p className="text-sm font-bold text-sky-700">{salary}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="px-4 sm:px-6 py-6 flex justify-center items-center gap-2">
            {page > 1 && (
              <Link href={buildHref(page - 1)} className="text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">
                前へ
              </Link>
            )}
            <span className="text-sm text-gray-500">{page} / {totalPages}</span>
            {page < totalPages && (
              <Link href={buildHref(page + 1)} className="text-sm px-3 py-2 rounded border border-gray-200 hover:bg-gray-50">
                次へ
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
