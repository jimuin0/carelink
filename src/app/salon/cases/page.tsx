import type { Metadata } from 'next';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'CareLink の現在地（掲載状況）',
  description:
    'CareLink は 2026年3月に公開したばかりのサービスです。掲載施設数・口コミ数の実データと、現在の運用状況を正直に公開しています。',
  alternates: { canonical: '/salon/cases' },
};

// 実データを毎リクエスト固定値で返さないよう、1時間ごとに再生成する。
export const revalidate = 3600;

/**
 * 【2026年7月28日・恒久是正】このページは以前、実在しない施設（吹田市・箕面市の事例）と
 * 実証不能な数値（月間新規予約12→28件・リピート率45→62% 等）を「実際に導入された施設の声」
 * として掲載していた。本番DBの実データ（掲載施設は全て豊中市の自社3施設・予約総数2件）と
 * 照合して虚偽であることが確定したため全削除した。
 *
 * 再発を「気をつける」で防ぐことはできないため、構造で防ぐ：
 * このページは実績値を一切ハードコードせず、必ず本番DBの count から取得する。
 * 数字が実態から乖離する経路そのものを無くすのが目的（症状ブロックでなく発症前予防）。
 * 新たに実績を載せたくなった場合も、必ず DB から引ける値に限ること。
 */
async function getPublicStats() {
  const supabase = createServerSupabaseClient();

  const [facilities, reviews, menus] = await Promise.all([
    supabase
      .from('facility_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published'),
    supabase.from('public_reviews').select('id', { count: 'exact', head: true }),
    supabase.from('facility_menus').select('id', { count: 'exact', head: true }),
  ]);

  return {
    facilityCount: facilities.count ?? 0,
    reviewCount: reviews.count ?? 0,
    menuCount: menus.count ?? 0,
  };
}

export default async function CasesPage() {
  const { facilityCount, reviewCount, menuCount } = await getPublicStats();

  return (
    <div className="section-container">
      <div className="max-w-4xl mx-auto">
        {/* ヒーロー */}
        <div className="text-center mb-12">
          <p className="text-sky-600 font-bold text-sm mb-2">CURRENT STATUS</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">CareLink の現在地</h1>
          <p className="text-gray-600 text-base leading-relaxed">
            CareLink は 2026年3月に公開したばかりのサービスです。
            <br className="hidden sm:block" />
            見栄えのする実績を並べる代わりに、いまの状況をそのままお伝えします。
          </p>
        </div>

        {/* 実データ（DBから取得・ハードコード禁止） */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { value: `${facilityCount}件`, label: '公開中の掲載施設' },
            { value: `${reviewCount}件`, label: '投稿された口コミ' },
            { value: `${menuCount}件`, label: '登録メニュー' },
          ].map((stat) => (
            <div key={stat.label} className="bg-sky-50 rounded-2xl p-5 text-center">
              <p className="text-2xl font-bold text-sky-600">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 text-center mb-12">
          ※上記はデータベースから自動取得している実数です（1時間ごとに更新）。
        </p>

        {/* 正直な現状説明 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">いま掲載されているのは、開発元自身の施設です</h2>
          <div className="space-y-4 text-sm text-gray-600 leading-relaxed">
            <p>
              現在 CareLink に掲載されている施設は、運営元（HALグループ・大阪府豊中市）が実際に運営している店舗です。
              自分たちが毎日の予約受付・顧客管理に使いながら、使いにくい部分を直し続けている段階にあります。
            </p>
            <p>
              つまり CareLink は、まだ「多くの施設に選ばれた実績のあるサービス」ではありません。
              他社サービスの導入事例ページのような華々しい数字を、いまのわたしたちはお見せできません。
            </p>
            <p className="text-gray-800 font-medium">
              その代わり、掲載料・予約手数料は完全に無料です。合わなければいつでも非公開にできますし、違約金もありません。
              リスクなく試していただける状態を用意することが、実績のないサービスにできる誠実さだと考えています。
            </p>
          </div>
        </div>

        {/* 導入施設の声について */}
        <div className="bg-gray-50 rounded-2xl p-6 sm:p-8 mb-12">
          <h2 className="text-lg font-bold text-gray-900 mb-3">導入施設さまの事例について</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            外部の施設さまの導入事例・お客様の声は、実際にご利用いただき、
            掲載のご了承をいただけた時点で、こちらのページに公開します。
            推測や想定にもとづく事例をお見せすることはいたしません。
          </p>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-br from-sky-500 to-sky-600 rounded-3xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-3">最初の掲載施設になっていただけませんか</h2>
          <p className="text-white/80 mb-6">
            完全無料・初期費用ゼロ。まずは管理画面を見て、使えそうか確かめてください。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/salon/demo"
              className="bg-white text-sky-600 font-bold px-8 py-3 rounded-full hover:bg-gray-50 transition-colors"
            >
              管理画面を見てみる
            </Link>
            <Link
              href="/auth/signup?role=owner"
              className="border-2 border-white text-white font-bold px-8 py-3 rounded-full hover:bg-white/10 transition-colors"
            >
              無料で施設登録
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
