import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { allPrefectureSlugs, allBusinessTypeSlugs, getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import { getAllCitySlugs, getCitySlug } from '@/data/city-slugs';
import { articles } from '@/data/articles';
import { SITE_URL } from '@/lib/constants';
import { SHOW_JOBS } from '@/lib/feature-toggles';

// 完全動的: 環境変数変更/施設追加を即時反映、CDN静的化を完全回避
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updated = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: updated, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/salon`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/ranking`, lastModified: updated, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/blog`, lastModified: updated, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/recruit`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/legal`, lastModified: new Date('2026-03-19'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/register`, lastModified: updated, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified: updated, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/symptom-checker`, lastModified: updated, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/salon/demo`, lastModified: updated, changeFrequency: 'monthly', priority: 0.6 },
  ];

  const supabase = createServerSupabaseClient();

  // Dynamic facility pages（prefecture, business_type も取得して 0件エリアを除外）
  const { data: facilities } = await supabase
    .from('facility_profiles')
    .select('slug, updated_at, prefecture, business_type, city')
    .eq('status', 'published');

  // 施設が存在するエリアの Set を構築（薄いコンテンツページをサイトマップから除外）
  // 注: crossPages 生成より前に宣言する（TDZ 回避 — Cannot access before initialization 防止）
  //
  // 【2026年7月31日・実装漏れの是正】この「薄いコンテンツ除外」は元々
  // 都道府県×業種・市区町村×業種にだけ効いており、その親である
  // 都道府県ページ・市区町村ページ・業種トップは【無条件で全件掲載】していた。
  // 本番実測では sitemap のエリアURL 334 件のうち 328 件が施設0件で、
  // ローンチ直後に空ページを大量に Google へ提出する状態だった。
  // 除外の判定軸を階層ごとに用意し、全階層へ同じ規則を適用する。
  const occupiedPref = new Set<string>();
  const occupiedType = new Set<string>();
  const occupiedCity = new Set<string>();
  const occupiedPrefType = new Set<string>();
  const occupiedCityType = new Set<string>();
  for (const f of facilities || []) {
    const ps = getPrefectureSlug(f.prefecture);
    const ts = getBusinessTypeSlug(f.business_type);
    if (ps) occupiedPref.add(ps);
    if (ts) occupiedType.add(ts);
    if (ps && f.city) {
      const cs = getCitySlug(ps, f.city);
      if (cs) occupiedCity.add(`${ps}/${cs}`);
    }
    if (ps && ts) {
      occupiedPrefType.add(`${ps}/${ts}`);
      // f.city は DB の生の市区町村名。cityTypePages 側は citySlug で URL を作るため、
      // ここで名前→slug 変換して slug 基準で記録しないと Set の照合が成立しない（旧コードは
      // 生名のまま add していたため occupiedCityType が一度も参照されない死蔵 Set になっていた）。
      if (f.city) {
        const cs = getCitySlug(ps, f.city);
        if (cs) occupiedCityType.add(`${ps}/${cs}/${ts}`);
      }
    }
  }

  // 業種別グローバルページ（/type/[typeSlug]）— 施設が1件以上ある業種のみ掲載。
  const businessTypeTopPages: MetadataRoute.Sitemap = allBusinessTypeSlugs
    .filter((slug) => occupiedType.has(slug))
    .map((slug) => ({
      url: `${SITE_URL}/type/${slug}`,
      lastModified: updated,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

  // Prefecture pages — 施設が1件以上ある都道府県のみ掲載。
  const prefecturePages: MetadataRoute.Sitemap = allPrefectureSlugs
    .filter((slug) => occupiedPref.has(slug))
    .map((slug) => ({
      url: `${SITE_URL}/${slug}`,
      lastModified: updated,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    }));

  // Prefecture x BusinessType pages — 施設が1件以上あるページのみ掲載（薄いコンテンツ除外）
  const crossPages: MetadataRoute.Sitemap = allPrefectureSlugs.flatMap((ps) =>
    allBusinessTypeSlugs
      .filter((ts) => occupiedPrefType.has(`${ps}/${ts}`))
      .map((ts) => ({
        url: `${SITE_URL}/${ps}/${ts}`,
        lastModified: updated,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }))
  );

  // Symptom pages
  const { data: symptoms } = await supabase.from('symptoms').select('slug');
  const symptomPages: MetadataRoute.Sitemap = (symptoms || []).map((s) => ({
    url: `${SITE_URL}/symptom/${s.slug}`,
    lastModified: updated,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  const facilityPages: MetadataRoute.Sitemap = (facilities || []).map((f) => ({
    url: `${SITE_URL}/facility/${f.slug}`,
    lastModified: f.updated_at ? new Date(f.updated_at) : updated,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // Feature pages — 施設が1件以上出るものだけ掲載（エリアページと同じ「薄いコンテンツ除外」方針）。
  //
  // 【2026年8月12日・実装漏れの是正】2026年7月31日にエリアURLの薄いコンテンツを除外した際、
  // 判定軸を階層ごとに用意して全階層へ同じ規則を適用したが、
  // 【特集ページだけがその是正から漏れて無条件で全件掲載のままだった】。
  // 本番実測（2026年8月12日）では公開中24件のうち3件が施設0件で、うち2件は
  // filter_type が「ヘアサロン」「リラクサロン」＝実在する business_type に無い値のため
  // 恒久的に0件（現存施設は「ネイル・まつげサロン」2件と「鍼灸院・整骨院」1件のみ）。
  //
  // ここで判定できるのは type / prefecture まで。filter_keyword による0件は特集ごとに
  // クエリを投げないと分からず sitemap の生成コスト（force-dynamic・毎回実行）に見合わないため、
  // ページ側の generateMetadata が robots noindex を出して補完する
  // （src/app/feature/[slug]/page.tsx・両方そろって初めて漏れなく塞がる）。
  const occupiedBusinessTypeRaw = new Set<string>();
  const occupiedPrefectureRaw = new Set<string>();
  for (const f of facilities || []) {
    if (f.business_type) occupiedBusinessTypeRaw.add(f.business_type);
    if (f.prefecture) occupiedPrefectureRaw.add(f.prefecture);
  }

  const { data: features } = await supabase
    .from('features')
    .select('slug, updated_at, filter_type, filter_prefecture')
    .eq('is_published', true);

  const qualifyingFeatures = (features || []).filter((f) => {
    // 空文字は「未設定」扱い（ページ側 `feature.filter_type || undefined` と同じ意味論）。
    if (f.filter_type && !occupiedBusinessTypeRaw.has(f.filter_type)) return false;
    if (f.filter_prefecture && !occupiedPrefectureRaw.has(f.filter_prefecture)) return false;
    return true;
  });

  // 一覧 `/feature` 自体も、載せる詳細ページが 1 本も無いなら出さない。
  // 中身が「特集記事を準備中です」だけのページを検索エンジンへ提出しても価値が無く、
  // 詳細ページを除外しておきながら一覧だけ出すのは規則として一貫しない
  // （ページ側は generateMetadata が空リストのとき noindex を出して補完する）。
  const featurePages: MetadataRoute.Sitemap = [
    ...(qualifyingFeatures.length > 0
      ? [{ url: `${SITE_URL}/feature`, lastModified: updated, changeFrequency: 'weekly' as const, priority: 0.6 }]
      : []),
    ...qualifyingFeatures
      .map((f) => ({
        url: `${SITE_URL}/feature/${f.slug}`,
        lastModified: f.updated_at ? new Date(f.updated_at) : updated,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
  ];

  // City pages — 施設が1件以上ある市区町村のみ掲載（cityTypePages と同じ方針）。
  const allCities = getAllCitySlugs();
  const cityPages: MetadataRoute.Sitemap = allCities
    .filter((c) => occupiedCity.has(`${c.prefectureSlug}/${c.citySlug}`))
    .map((c) => ({
      url: `${SITE_URL}/${c.prefectureSlug}/${c.citySlug}`,
      lastModified: updated,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }));

  // City x BusinessType pages (top cities only)
  const majorPrefectures = ['tokyo', 'osaka', 'kanagawa', 'aichi', 'fukuoka', 'saitama', 'chiba', 'hyogo', 'kyoto', 'hokkaido'];
  const majorCities = allCities.filter((c) => majorPrefectures.includes(c.prefectureSlug));
  // 施設が1件以上ある市区町村×業種ページのみ掲載（薄いコンテンツ除外）。crossPages と同じ方針。
  const cityTypePages: MetadataRoute.Sitemap = majorCities.flatMap((c) =>
    allBusinessTypeSlugs
      .filter((ts) => occupiedCityType.has(`${c.prefectureSlug}/${c.citySlug}/${ts}`))
      .map((ts) => ({
        url: `${SITE_URL}/${c.prefectureSlug}/${c.citySlug}/${ts}`,
        lastModified: updated,
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }))
  );

  // Blog articles (from static data)
  const blogPages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${SITE_URL}/blog/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  // Jobs (公開施設に紐づくもののみ)。SHOW_JOBS=false の間はローンチ判断により掲載自体をスキップする
  // （src/lib/feature-toggles.ts 参照・true に戻すだけで復活）。
  let jobPages: MetadataRoute.Sitemap = [];
  if (SHOW_JOBS) {
    const { data: jobs } = await supabase
      .from('facility_jobs')
      .select('id, updated_at, facility_profiles!inner(slug, status)')
      .eq('facility_profiles.status', 'published');
    jobPages = [
      { url: `${SITE_URL}/jobs`, lastModified: updated, changeFrequency: 'daily' as const, priority: 0.7 },
      ...((jobs || []) as Array<{ id: string; updated_at: string | null }>).map((j) => ({
        url: `${SITE_URL}/jobs/${j.id}`,
        lastModified: j.updated_at ? new Date(j.updated_at) : updated,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ];
  }
  return [...staticPages, ...businessTypeTopPages, ...prefecturePages, ...crossPages, ...cityPages, ...cityTypePages, ...facilityPages, ...featurePages, ...blogPages, ...symptomPages, ...jobPages];
}
