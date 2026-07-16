import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { SITE_URL } from '@/lib/constants';
import { safeJsonLd } from '@/lib/json-ld';

export const revalidate = 3600;

interface Props {
  params: Promise<{ id: string }>;
}

interface JobRow {
  id: string;
  facility_id: string;
  title: string;
  job_type: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_note: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  created_at: string;
  updated_at: string;
  facility_profiles: {
    id: string;
    name: string;
    slug: string;
    business_type: string;
    prefecture: string;
    city: string;
    address: string | null;
    postal_code: string | null;
    website_url: string | null;
    main_photo_url: string | null;
    status: string;
  } | null;
}

async function getJob(id: string): Promise<JobRow | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_jobs')
    .select(
      `id, facility_id, title, job_type, employment_type, salary_min, salary_max, salary_note,
       description, requirements, benefits, created_at, updated_at,
       facility_profiles!inner ( id, name, slug, business_type, prefecture, city, address, postal_code, website_url, main_photo_url, status )`
    )
    .eq('id', id)
    .eq('facility_profiles.status', 'published')
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as JobRow;
}

function mapEmploymentType(jp: string): string {
  if (jp.includes('正社員')) return 'FULL_TIME';
  if (jp.includes('アルバイト') || jp.includes('パート')) return 'PART_TIME';
  if (jp.includes('業務委託')) return 'CONTRACTOR';
  if (jp.includes('派遣') || jp.includes('臨時')) return 'TEMPORARY';
  if (jp.includes('インターン')) return 'INTERN';
  return 'OTHER';
}

function formatSalary(min: number | null, max: number | null, note: string | null): string {
  if (min && max) return `月給 ¥${min.toLocaleString()} 〜 ¥${max.toLocaleString()}`;
  if (min) return `月給 ¥${min.toLocaleString()} 〜`;
  if (max) return `月給 〜 ¥${max.toLocaleString()}`;
  return note || '応相談';
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const job = await getJob(params.id);
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  if (!job || !job.facility_profiles) return { title: '求人が見つかりません' };
  const f = job.facility_profiles;
  const title = `${job.title} | ${f.name}（${f.prefecture}${f.city}）の求人`;
  const description =
    (job.description || `${f.name}が${job.job_type}（${job.employment_type}）を募集中。${f.prefecture}${f.city}。`).slice(0, 160);
  const url = `${SITE_URL}/jobs/${job.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: 'article',
      url,
      siteName: 'CareLink',
      images: [
        {
          url: `${SITE_URL}/api/og?title=${encodeURIComponent(job.title)}&subtitle=${encodeURIComponent(f.name + ' | ' + f.prefecture + f.city)}`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function JobDetailPage(props: Props) {
  const params = await props.params;
  const job = await getJob(params.id);
  if (!job || !job.facility_profiles) notFound();
  const f = job.facility_profiles;

  const datePosted = new Date(job.created_at).toISOString();
  const validThrough = new Date(new Date(job.created_at).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const employmentType = mapEmploymentType(job.employment_type);

  const jobPostingLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || `${f.name}の${job.job_type}求人`,
    datePosted,
    validThrough,
    employmentType,
    industry: job.job_type,
    hiringOrganization: {
      '@type': 'Organization',
      name: f.name,
      sameAs: f.website_url || `${SITE_URL}/facility/${f.slug}`,
      ...(f.main_photo_url && { logo: f.main_photo_url }),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: f.address || '',
        addressLocality: f.city,
        addressRegion: f.prefecture,
        postalCode: f.postal_code || '',
        addressCountry: 'JP',
      },
    },
  };

  if (job.salary_min || job.salary_max) {
    jobPostingLd.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'JPY',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salary_min && { minValue: job.salary_min }),
        ...(job.salary_max && { maxValue: job.salary_max }),
        unitText: 'MONTH',
      },
    };
  }
  if (job.requirements) jobPostingLd.qualifications = job.requirements;
  if (job.benefits) jobPostingLd.jobBenefits = job.benefits;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'トップ', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '求人一覧', item: `${SITE_URL}/jobs` },
      { '@type': 'ListItem', position: 3, name: f.name, item: `${SITE_URL}/facility/${f.slug}` },
      { '@type': 'ListItem', position: 4, name: job.title },
    ],
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        {/* パンくず */}
        <nav className="px-4 sm:px-6 pt-4 pb-2" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400 overflow-x-auto">
            <li><Link href="/" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href="/jobs" className="hover:text-sky-600">求人一覧</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${f.slug}`} className="hover:text-sky-600 truncate max-w-[140px]">{f.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium truncate max-w-[200px]">{job.title}</li>
          </ol>
        </nav>

        {/* ヘッダー */}
        <div className="px-4 sm:px-6 py-6 border-b border-gray-100">
          <div className="flex items-start gap-4">
            {f.main_photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              (<img src={f.main_photo_url} alt={f.name} className="w-20 h-20 object-cover rounded-xl shrink-0" />)
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded font-medium">{job.job_type}</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-medium">{job.employment_type}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold mb-2 leading-snug">{job.title}</h1>
              <Link href={`/facility/${f.slug}`} className="text-sm text-sky-600 hover:underline">
                {f.name}
              </Link>
              <p className="text-sm text-gray-500 mt-1">{f.prefecture}{f.city}{f.address || ''}</p>
            </div>
          </div>
          <div className="mt-4 bg-sky-50 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">給与</p>
            <p className="text-lg font-bold text-sky-700">{formatSalary(job.salary_min, job.salary_max, job.salary_note)}</p>
            {job.salary_note && (job.salary_min || job.salary_max) && (
              <p className="text-xs text-gray-500 mt-1">{job.salary_note}</p>
            )}
          </div>
        </div>

        {/* 詳細セクション */}
        <div className="px-4 sm:px-6 py-6 space-y-6">
          {job.description && (
            <section>
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-sky-500 rounded-full" />
                仕事内容
              </h2>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{job.description}</p>
            </section>
          )}
          {job.requirements && (
            <section>
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-amber-400 rounded-full" />
                応募資格・必須スキル
              </h2>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{job.requirements}</p>
            </section>
          )}
          {job.benefits && (
            <section>
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <span className="w-1 h-5 bg-emerald-400 rounded-full" />
                福利厚生・待遇
              </h2>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{job.benefits}</p>
            </section>
          )}

          <section>
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              <span className="w-1 h-5 bg-sky-500 rounded-full" />
              募集概要
            </h2>
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex"><span className="text-gray-500 w-24 shrink-0">職種</span><span>{job.job_type}</span></div>
              <div className="flex"><span className="text-gray-500 w-24 shrink-0">雇用形態</span><span>{job.employment_type}</span></div>
              <div className="flex"><span className="text-gray-500 w-24 shrink-0">勤務地</span><span>{f.prefecture}{f.city}{f.address || ''}</span></div>
              <div className="flex"><span className="text-gray-500 w-24 shrink-0">給与</span><span>{formatSalary(job.salary_min, job.salary_max, job.salary_note)}</span></div>
              <div className="flex"><span className="text-gray-500 w-24 shrink-0">掲載日</span><span>{new Date(job.created_at).toLocaleDateString('ja-JP')}</span></div>
            </div>
          </section>
        </div>

        {/* 応募ボタン */}
        <div className="px-4 sm:px-6 py-6 border-t border-gray-100">
          <Link
            href={`/facility/${f.slug}#contact-section`}
            className="block w-full text-center bg-sky-600 hover:bg-sky-700 text-white font-bold py-4 rounded-xl transition-colors"
          >
            この求人に応募する
          </Link>
          <p className="text-xs text-gray-400 text-center mt-3">
            応募フォームは「{f.name}」のお問い合わせ欄から送信されます
          </p>
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jobPostingLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }}
      />
    </div>
  );
}
