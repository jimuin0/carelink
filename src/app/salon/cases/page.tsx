import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '導入事例・お客様の声 | CareLink サロン向け',
  description: 'CareLinkを導入した鍼灸院・整骨院・エステサロンの成功事例をご紹介。予約管理の効率化、集客増加、顧客満足度向上を実現した施設の声をお届けします。',
  alternates: { canonical: '/salon/cases' },
};

const cases = [
  {
    id: 1,
    facilityType: '鍼灸院',
    prefecture: '大阪府豊中市',
    name: '豊中鍼灸院（仮名）',
    period: '2026年1月〜',
    results: [
      { label: 'オンライン予約率', before: '0%', after: '68%' },
      { label: '電話対応時間', before: '1日2時間', after: '30分以下' },
      { label: '月間新規予約', before: '12件', after: '28件' },
    ],
    voice: 'HPBに月4万円払っていましたが、CareLinkに移行してから費用ゼロで同等の集客ができています。LINE通知で患者さんへの連絡もスムーズになりました。',
    owner: 'オーナー院長（50代）',
    tags: ['電話問い合わせ削減', 'LINE通知', '予約管理効率化'],
  },
  {
    id: 2,
    facilityType: '整体院',
    prefecture: '大阪府吹田市',
    name: '吹田整体院（仮名）',
    period: '2026年2月〜',
    results: [
      { label: '予約ダブルブッキング', before: '月1〜2件', after: '0件' },
      { label: '顧客情報管理', before: '手書きノート', after: 'デジタル一元管理' },
      { label: 'リピート率', before: '45%', after: '62%' },
    ],
    voice: 'スタッフのスケジュール管理が一番助かっています。誰がいつ空いているか一目でわかるし、ダブルブッキングのミスもなくなりました。クーポン機能でリピーターも増えています。',
    owner: '受付スタッフ（30代）',
    tags: ['スケジュール管理', 'ダブルブッキング防止', 'クーポン活用'],
  },
  {
    id: 3,
    facilityType: 'エステサロン',
    prefecture: '大阪府箕面市',
    name: '箕面エステサロン（仮名）',
    period: '2026年3月〜',
    results: [
      { label: '口コミ件数', before: '0件', after: '15件（2ヶ月）' },
      { label: 'Google検索表示', before: '圏外', after: '地域上位' },
      { label: '予約単価', before: '¥4,800', after: '¥6,200' },
    ],
    voice: '口コミ機能が思った以上に効果的でした。施術後にCareLinkから口コミ依頼が自動で届くので、お客様も投稿しやすいみたいです。Googleマップの評価も上がりました。',
    owner: 'オーナー（40代）',
    tags: ['口コミ集め', 'SEO対策', 'Google評価向上'],
  },
];

export default function CasesPage() {
  return (
    <div className="section-container">
      <div className="max-w-4xl mx-auto">
        {/* ヒーロー */}
        <div className="text-center mb-12">
          <p className="text-sky-600 font-bold text-sm mb-2">CASE STUDIES</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">導入事例・お客様の声</h1>
          <p className="text-gray-500 text-base">
            実際にCareLinkを導入された施設の声をご紹介します。
          </p>
        </div>

        {/* 統計サマリー */}
        <div className="grid grid-cols-3 gap-4 mb-12">
          {[
            { value: '3施設+', label: '導入施設（2026年4月時点）' },
            { value: '68%', label: 'オンライン予約比率（平均）' },
            { value: '¥40,000/月', label: '平均コスト削減額' },
          ].map((stat) => (
            <div key={stat.label} className="bg-sky-50 rounded-2xl p-5 text-center">
              <p className="text-2xl font-bold text-sky-600">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* 事例リスト */}
        <div className="space-y-8">
          {cases.map((c) => (
            <article key={c.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">{c.facilityType}</span>
                  <span className="text-white/80 text-sm">{c.prefecture}</span>
                </div>
                <h2 className="text-white font-bold text-lg mt-2">{c.name}</h2>
                <p className="text-white/70 text-xs mt-1">導入時期: {c.period}</p>
              </div>

              <div className="p-6">
                {/* 成果 */}
                <h3 className="text-sm font-bold text-gray-700 mb-3">導入前後の変化</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                  {c.results.map((r) => (
                    <div key={r.label} className="bg-gray-50 rounded-xl p-4">
                      <p className="text-xs text-gray-500 mb-2">{r.label}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400 line-through">{r.before}</span>
                        <span className="text-xs text-gray-400">→</span>
                        <span className="text-sm font-bold text-sky-600">{r.after}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 口コミ */}
                <blockquote className="bg-sky-50 border-l-4 border-sky-400 rounded-r-xl px-5 py-4 mb-4">
                  <p className="text-gray-700 text-sm leading-relaxed">&ldquo;{c.voice}&rdquo;</p>
                  <footer className="text-xs text-gray-500 mt-2">— {c.owner}</footer>
                </blockquote>

                {/* タグ */}
                <div className="flex flex-wrap gap-2">
                  {c.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{tag}</span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 bg-gradient-to-br from-sky-500 to-sky-600 rounded-3xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-3">あなたのサロンも始めませんか？</h2>
          <p className="text-white/80 mb-6">完全無料・初期費用ゼロ。今すぐ施設登録して試してみてください。</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/salon/demo" className="bg-white text-sky-600 font-bold px-8 py-3 rounded-full hover:bg-gray-50 transition-colors">
              管理画面を見てみる
            </Link>
            <Link href="/auth/signup?role=owner" className="border-2 border-white text-white font-bold px-8 py-3 rounded-full hover:bg-white/10 transition-colors">
              無料で施設登録
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
