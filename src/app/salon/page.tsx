import type { Metadata } from 'next';
import Link from 'next/link';
import FAQ from '@/components/FAQ';
import SavingsSimulator from '@/components/salon/SavingsSimulator';

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  // openGraph.title はテンプレ非適用のためフルタイトルのまま維持する。
  title: '施設を掲載しませんか？',
  description: 'CareLink（ケアリンク）は美容・医療・福祉施設向けの掲載・予約管理サービス。掲載料と予約手数料の現在条件、準備内容、公開までの流れを確認できます。',
  alternates: { canonical: '/salon' },
  openGraph: {
    title: '施設を掲載しませんか？ | CareLink',
    description: '掲載料と予約手数料の現在条件、登録前に準備する情報、公開までの流れを確認できます。',
    type: 'website',
  },
};

const faqItems = [
  { question: '掲載料や予約手数料はかかりますか？', answer: '利用規約では掲載料・予約手数料を無料としています。将来有料プランを設定する場合は、規約に基づき事前に通知します。登録前に最新の利用条件をご確認ください。' },
  { question: '他の掲載サービスと比べるときは何を確認すればよいですか？', answer: '掲載料だけでなく、予約成立時の手数料、予約受付の方法、顧客・メニュー管理の範囲、既存の予約方法との併用、非公開・退会時の扱いを確認してください。' },
  { question: '掲載開始までに何を準備しますか？', answer: '施設名・業種・連絡先などの基本情報に加え、必要に応じて住所、営業時間、メニュー、写真、紹介文を準備します。公開時期は準備状況や確認内容によって異なります。' },
  { question: 'いつでも非公開や退会ができますか？', answer: '掲載者は管理画面から施設情報を非公開にできます。退会時のデータの扱いなどは利用規約をご確認ください。' },
  { question: 'どんな業種が掲載できますか？', answer: '美容サロン・アイラッシュ・鍼灸院・整骨院・介護施設・病院・クリニックなど。対象か不明な場合はお問い合わせください。' },
  { question: '自分で管理画面を操作できますか？', answer: 'はい。メニュー・スタッフ・写真・クーポン・予約管理・売上分析まで、全てブラウザから操作できます。' },
];

export default function SalonPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="section-container text-center">
          {/* 【2026年7月28日】ファーストビューの主語を他社から自社へ変える。
              以前は「大手ポータルと同じ機能が」と他社を基準にした表現で、
              第一印象で語るべき自社の価値が他社の引き立て役になっていた。
              比較表は下部セクションに残し、ここでは CareLink 自身が何を提供するかだけを述べる。 */}
          <p className="text-sky-200 text-sm font-medium mb-3">掲載料・予約手数料 0円（現在の利用条件）</p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight">
            予約管理から集客まで、
            <br />
            <span className="text-amber-300">条件を確認して掲載を始める</span>
          </h1>
          <p className="text-sky-100 text-lg sm:text-xl mb-8">
            オンライン予約・口コミ・クーポン・顧客管理・売上分析。<br className="hidden sm:block" />
            サロン運営に必要な機能を、ひとつの管理画面で。
          </p>
          <Link href="/register" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-sky-700 font-bold rounded-lg text-lg hover:bg-sky-50 transition-all shadow-lg">
            掲載条件を確認して登録する
          </Link>
          <p className="text-sky-200 text-xs mt-3">必要な情報を準備して登録 ・ クレジットカード不要</p>
          {/* 【ローンチ時非公開】決済手段（Stripe/PAY.JP）未導入のため、有料プラン（/salon/premium）
              への導線を外している。決済導入時にこのリンクと premium ページの LAUNCH_HIDDEN を
              戻すだけで復活する（featured-ads と同じ可逆方式）。 */}
        </div>
      </section>

      {/* 他社比較 */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">他社サービスとの比較</h2>
          <div className="max-w-3xl mx-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-normal w-1/3">確認項目</th>
                  <th className="py-3 px-4 text-center bg-sky-50 rounded-t-xl">
                    <span className="text-sky-700 font-bold text-base">CareLinkの現在条件</span>
                  </th>
                  <th className="py-3 px-4 text-center text-gray-500">登録前に確認したいこと</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  【掲載を検討する施設への約束・2026年7月29日 是正】
                  ここに ✅ を書ける条件は「施設が管理画面から自分で設定でき、それが実際に届くこと」
                  であって、ソースファイルや DB 列が存在することではない。実際、Claude が
                  ファイルの存在だけを根拠に ✅ を正しいと報告し、神原さんの指摘で誤りが判明した。
                  本番の実データと環境変数キー名で調べ直し、以下の3行を落とした。
                    - LINE通知連携：送信コードは booking / cancel / booking-status / booking-reminder に
                      配線済みで LINE_CHANNEL_ACCESS_TOKEN_CARELINK も設定済み。しかし
                      NEXT_PUBLIC_LIFF_ID が未設定で顧客が連携する入口が無く、line_user_links 0件・
                      line_notification_logs 0件＝本番で一度も送信されていなかった。
                      ローンチに含めないと神原さんが決定（2026年7月29日）
                    - 症状別検索（鍼灸院）：/symptom/[slug] の公開ページは実在し症状マスタも30件あるが、
                      facility_symptoms へ書き込む管理UI・APIがアプリ全体で0件のため、
                      施設は自分の対応症状を登録できず症状ページに載れない
                    - 保険適用メニュー対応：施設ページ側に表示バッジ（MenuList.tsx）はあるが、
                      insurance_covered を書き込む管理UI・APIが0件で施設は設定できない
                  後者2つは管理画面を作れば ✅ に戻せる。その時はこのコメントも更新すること。
                  src/__tests__/salon-comparison-claims.test.ts が、書き込み経路の無い機能を
                  ✅ として書き足すことをCIで止める。
                */}
                {[
                  ['月額費用', '掲載料は無料', '月額費用の有無と対象範囲'],
                  ['予約手数料', '予約手数料は無料', '予約成立時の手数料'],
                  ['オンライン予約', '予約受付機能を提供', '予約受付の方法と設定範囲'],
                  ['口コミ・評価', '施設ページで表示・管理', '口コミへの対応範囲'],
                  ['クーポン管理', '管理画面で確認できる機能', '利用できる機能と条件'],
                  ['スタッフ管理', '管理画面で確認できる機能', '登録人数や権限の範囲'],
                  ['売上分析', '管理画面で確認できる機能', '分析対象と利用条件'],
                  ['顧客管理', '管理画面で確認できる機能', '保存項目と退会時の扱い'],
                  ['非公開・退会', '規約と管理画面の案内を確認', '非公開・退会時の扱い'],
                ].map(([feature, carelink, otherA]) => (
                  <tr key={feature} className="border-b border-gray-100">
                    <td className="py-3 px-4 text-gray-600">{feature}</td>
                    <td className="py-3 px-4 text-center bg-sky-50 font-bold text-sky-700">{carelink}</td>
                    <td className="py-3 px-4 text-center text-gray-500">{otherA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-gray-500 mt-4">※CareLinkの料金条件は利用規約に基づく現在の案内です。機能の詳細と公開・退会の条件は登録前に各案内をご確認ください。</p>
        </div>
      </section>

      {/* 機能一覧 */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">管理画面で確認できる主な機能</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { icon: '📋', title: 'メニュー・料金掲載', desc: 'カテゴリ別にメニューを管理。写真付きで魅力を伝える' },
              { icon: '📅', title: 'オンライン予約', desc: '予約受付と空き枠を管理画面で設定' },
              { icon: '⭐', title: '口コミ・評価', desc: 'お客様の声で信頼度UP。サロン返信機能付き' },
              { icon: '🎫', title: 'クーポン管理', desc: '新規限定・リピーター向け等、タイプ別クーポン発行' },
              { icon: '👤', title: 'スタッフ管理', desc: '指名予約・指名料設定・ポートフォリオ掲載' },
              { icon: '📊', title: '売上・顧客分析', desc: '日別売上・予約推移・顧客情報を確認' },
              { icon: '📷', title: '写真管理', desc: '施設・メニュー・スタッフ写真をアップロード・管理' },
              { icon: '🔔', title: '通知設定', desc: '予約などの通知方法を管理画面で確認' },
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
          <h2 className="section-title">掲載開始までの準備</h2>
          <div className="grid sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: '基本情報を入力', desc: '施設名・業種・連絡先を入力' },
              { step: '2', title: 'アカウントを作成', desc: '登録内容を確認してログイン' },
              { step: '3', title: '掲載情報を準備', desc: 'メニュー・写真・紹介文を登録' },
              { step: '4', title: '公開条件を確認', desc: '準備が整ったら公開を進める' },
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
          <p className="text-gray-500 text-xs mt-4">その他の業種もご相談ください</p>
        </div>
      </section>

      {/* 現在の掲載状況（2026年7月28日・恒久是正）
          以前ここには「電話予約68%削減」「リピート率+17%」等の数値を、実在しない施設
          （吹田・箕面）の導入成果として掲載していた。本番DBの実データと照合して虚偽と確定した
          ため全削除。実績値をこのページにハードコードすることは今後もしない（実態と乖離する
          経路を構造的に断つ）。実数は /salon/cases が DB から自動取得して表示する。 */}
      <section className="bg-sky-50">
        <div className="section-container text-center">
          <h2 className="section-title">CareLink はまだ始まったばかりです</h2>
          <p className="text-gray-600 text-sm max-w-2xl mx-auto leading-relaxed mb-6">
            2026年3月に公開したばかりで、いま掲載されているのは運営元自身が営む施設です。
            華々しい導入実績はまだありません。だからこそ掲載料も予約手数料も無料で、
            合わなければいつでも非公開にできる形にしています。
          </p>
          <Link href="/salon/cases" className="inline-flex items-center gap-2 text-sky-700 font-bold hover:underline">
            現在の掲載状況を見る →
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">よくある質問</h2>
          <FAQ items={faqItems} />
        </div>
      </section>

      {/* 節約シミュレーター */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">今すぐいくら節約できるか試してみる</h2>
          <SavingsSimulator />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="section-container text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">掲載条件を確認して始める</h2>
          <p className="text-sky-100 mb-8">掲載料・予約手数料の現在条件と、必要な準備を確認できます。</p>
          <Link href="/register" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-sky-700 font-bold rounded-lg text-lg hover:bg-sky-50 transition-all shadow-lg">
            掲載条件を確認して登録する
          </Link>
          <p className="text-sky-200 text-xs mt-3">必要な情報を準備して登録 ・ クレジットカード不要</p>
        </div>
      </section>
    </>
  );
}
