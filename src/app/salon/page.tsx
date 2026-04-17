import type { Metadata } from 'next';
import Link from 'next/link';
import FAQ from '@/components/FAQ';
import HpbSimulator from '@/components/salon/HpbSimulator';

export const metadata: Metadata = {
  title: '施設を掲載しませんか？ | CareLink',
  description: 'CareLink（ケアリンク）は掲載料無料の美容・医療・福祉ポータルサイト。HPBと同等機能が完全無料。最短3分で掲載登録完了。',
  alternates: { canonical: '/salon' },
  openGraph: {
    title: '施設を掲載しませんか？ | CareLink',
    description: '掲載料無料。HPBと同等機能が0円。登録3分・すぐに集客開始。',
    type: 'website',
  },
};

const faqItems = [
  { question: '本当に無料ですか？追加料金は？', answer: '完全無料です。初期費用・月額費用・成果報酬・予約手数料など一切かかりません。今後も基本機能は永久無料です。' },
  { question: 'HPBとの違いは？', answer: 'HPBは月額数万〜数十万円かかりますが、CareLinkは同等機能が完全無料。LINE予約通知・顧客分析・リアルタイム予約管理など、HPBにない機能もあります。' },
  { question: '掲載開始までどのくらい？', answer: '登録後すぐにメニュー・写真を登録でき、準備ができたら自分で「公開」ボタンを押すだけ。最短当日に掲載開始できます。' },
  { question: 'いつでもやめられますか？', answer: 'はい。管理画面から「非公開」にするだけ。違約金・解約金は一切ありません。' },
  { question: 'どんな業種が掲載できますか？', answer: '美容サロン・アイラッシュ・鍼灸院・整骨院・介護施設・病院・クリニックなど。対象か不明な場合はお問い合わせください。' },
  { question: '自分で管理画面を操作できますか？', answer: 'はい。メニュー・スタッフ・写真・クーポン・予約管理・売上分析まで、全てブラウザから操作できます。' },
];

export default function SalonPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="section-container text-center">
          <p className="text-sky-200 text-sm font-medium mb-3">掲載料・予約手数料 完全無料</p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight">
            HPBと同じ機能が
            <br />
            <span className="text-amber-300">ずっと0円</span>
          </h1>
          <p className="text-sky-100 text-lg sm:text-xl mb-8">
            オンライン予約・口コミ・クーポン・顧客管理・LINE通知。<br className="hidden sm:block" />
            全部無料で使えるサロン予約プラットフォーム。
          </p>
          <Link href="/register" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-sky-700 font-bold rounded-lg text-lg hover:bg-sky-50 transition-all shadow-lg">
            今すぐ無料で掲載する
          </Link>
          <p className="text-sky-200 text-xs mt-3">3分で登録完了 ・ クレジットカード不要</p>
        </div>
      </section>

      {/* HPB比較 */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">他社サービスとの比較</h2>
          <div className="max-w-3xl mx-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-normal w-1/3"></th>
                  <th className="py-3 px-4 text-center bg-sky-50 rounded-t-xl">
                    <span className="text-sky-700 font-bold text-base">CareLink</span>
                  </th>
                  <th className="py-3 px-4 text-center text-gray-400">大手ポータルA</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['月額費用', '¥0', '¥25,000〜'],
                  ['初期費用', '¥0', '¥50,000〜'],
                  ['予約手数料', '¥0', '¥200/件〜'],
                  ['オンライン予約', '✅', '✅'],
                  ['口コミ・評価', '✅', '✅'],
                  ['クーポン管理', '✅', '✅'],
                  ['スタッフ管理', '✅', '✅'],
                  ['売上分析', '✅', '✅（上位プラン）'],
                  ['LINE通知連携', '✅', '❌'],
                  ['顧客RFM分析', '✅', '❌'],
                  ['リアルタイム予約通知', '✅', '❌'],
                  ['症状別検索（鍼灸院）', '✅', '❌'],
                  ['保険適用メニュー対応', '✅', '❌'],
                  ['最低契約期間', 'なし', '6ヶ月〜'],
                  ['解約金', '¥0', '契約残期間分'],
                ].map(([feature, carelink, other]) => (
                  <tr key={feature} className="border-b border-gray-100">
                    <td className="py-3 px-4 text-gray-600">{feature}</td>
                    <td className="py-3 px-4 text-center bg-sky-50 font-bold text-sky-700">{carelink}</td>
                    <td className="py-3 px-4 text-center text-gray-400">{other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">※大手ポータルAは一般的な美容ポータルサイトの料金体系を参考にしています</p>
        </div>
      </section>

      {/* 機能一覧 */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">全部無料で使える機能</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { icon: '📋', title: 'メニュー・料金掲載', desc: 'カテゴリ別にメニューを管理。写真付きで魅力を伝える' },
              { icon: '📅', title: 'オンライン予約', desc: '24時間ネット予約受付。空き枠自動計算で手間なし' },
              { icon: '⭐', title: '口コミ・評価', desc: 'お客様の声で信頼度UP。サロン返信機能付き' },
              { icon: '🎫', title: 'クーポン管理', desc: '新規限定・リピーター向け等、タイプ別クーポン発行' },
              { icon: '👤', title: 'スタッフ管理', desc: '指名予約・指名料設定・ポートフォリオ掲載' },
              { icon: '📊', title: '売上・顧客分析', desc: '日別売上チャート・リピート率・顧客セグメント自動分析' },
              { icon: '💬', title: 'LINE通知', desc: '予約確認・リマインド・キャンセルをLINEで自動通知' },
              { icon: '📷', title: '写真管理', desc: '施設・メニュー・スタッフ写真をアップロード・管理' },
              { icon: '🔔', title: 'リアルタイム通知', desc: '新規予約が入ったら即Push通知。見逃しゼロ' },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-xl p-5 shadow-sm">
                <span className="text-2xl">{item.icon}</span>
                <h3 className="text-sm font-bold text-gray-800 mt-2 mb-1">{item.title}</h3>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 利用の流れ */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">最短当日に掲載開始</h2>
          <div className="grid sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: '3分で登録', desc: '施設名・業種・連絡先を入力' },
              { step: '2', title: 'アカウント作成', desc: 'メールアドレスでログイン' },
              { step: '3', title: 'メニュー・写真追加', desc: '管理画面で自由に登録' },
              { step: '4', title: '公開！', desc: 'ボタン一つで集客スタート' },
            ].map((item, i) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 bg-sky-500">
                  {item.step}
                </div>
                <h3 className="font-bold mb-2 text-sm">{item.title}</h3>
                <p className="text-gray-500 text-xs">{item.desc}</p>
                {i < 3 && <div className="hidden sm:block text-sky-300 text-2xl mt-4">&rarr;</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 対象業種 */}
      <section className="bg-gray-50">
        <div className="section-container text-center">
          <h2 className="section-title">こんな施設におすすめ</h2>
          <div className="flex flex-wrap justify-center gap-3 max-w-2xl mx-auto">
            {['美容サロン', 'アイラッシュサロン', 'ネイルサロン', 'リラクサロン', 'エステサロン', '美容クリニック', '鍼灸院', '整骨院・接骨院', '整体院', '介護施設', 'デイサービス', '歯科クリニック'].map((t) => (
              <span key={t} className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm text-gray-700">{t}</span>
            ))}
          </div>
          <p className="text-gray-400 text-xs mt-4">その他の業種もご相談ください</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">よくある質問</h2>
          <FAQ items={faqItems} />
        </div>
      </section>

      {/* HPBシミュレーター */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">今すぐいくら節約できるか試してみる</h2>
          <HpbSimulator />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="section-container text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">HPBに払っている月額を0円に</h2>
          <p className="text-sky-100 mb-8">同じ機能が完全無料。リスクゼロで始められます。</p>
          <Link href="/register" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-sky-700 font-bold rounded-lg text-lg hover:bg-sky-50 transition-all shadow-lg">
            無料で掲載登録する
          </Link>
          <p className="text-sky-200 text-xs mt-3">3分で登録完了 ・ クレジットカード不要 ・ いつでも解約可</p>
        </div>
      </section>
    </>
  );
}
