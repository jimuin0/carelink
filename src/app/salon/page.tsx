import Link from 'next/link';
import FAQ from '@/components/FAQ';

const faqItems = [
  {
    question: '掲載は本当に無料ですか？',
    answer: 'はい、完全無料でご利用いただけます。初期費用・月額費用・成果報酬など一切かかりません。費用を気にせず、まずはお気軽にご登録ください。',
  },
  {
    question: '掲載開始までどのくらいかかりますか？',
    answer: 'フォーム送信後、3営業日以内に担当者が審査いたします。審査通過後、すぐに掲載を開始できます。',
  },
  {
    question: '途中で掲載をやめることはできますか？',
    answer: 'はい、いつでも掲載停止・退会が可能です。違約金等は一切ございません。掲載停止後はデータを速やかに削除いたします。',
  },
  {
    question: 'どのような業種が掲載できますか？',
    answer: '美容サロン・アイラッシュ、鍼灸院・整骨院、介護施設・デイサービス、病院・クリニックなど、医療・福祉・美容業界の施設が対象です。対象か不明な場合はお気軽にお問い合わせください。',
  },
  {
    question: '掲載内容はあとから変更できますか？',
    answer: 'はい、掲載後もいつでも内容の変更が可能です。メニューや料金の更新、写真の差し替えなど、担当者にご連絡いただければ対応いたします。',
  },
];

export default function SalonPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="section-container text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight">
            あなたの施設を、
            <br />
            <span className="text-primary">必要な人に届ける</span>
          </h1>
          <p className="text-gray-600 text-lg sm:text-xl mb-8">
            掲載無料・登録3分・すぐに集客開始
          </p>
          <Link href="/recruit" className="btn-primary text-lg">
            無料で掲載登録する
          </Link>
        </div>
      </section>

      {/* Merits */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">CareLink が選ばれる理由</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: '💰',
                title: '掲載・登録が完全無料',
                desc: '初期費用・月額費用は一切かかりません。リスクゼロで集客を始められます。',
              },
              {
                icon: '🎯',
                title: '医療・福祉・美容に特化',
                desc: '業界特化だからこそ、あなたの施設を必要としている人に確実に届きます。',
              },
              {
                icon: '📢',
                title: '業界特化の掲載',
                desc: '業界に特化しているから、あなたの施設を探している人に情報が届きます。',
              },
            ].map((item) => (
              <div key={item.title} className="card text-center">
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">CareLink でできること</h2>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { icon: '📋', title: '店舗プロフィール掲載', desc: 'メニュー・料金・写真を掲載して、あなたの施設の魅力をお客様に届けます。' },
              { icon: '👥', title: '予約・来店促進', desc: '業界特化だから、あなたの施設を必要としているお客様に情報が届きます。' },
              { icon: '📊', title: '専任担当サポート', desc: '掲載から集客まで、専任の担当者がサポート。運用の手間を最小限に抑えます。' },
            ].map((item) => (
              <div key={item.title} className="card text-center">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">ご利用の流れ</h2>
          <div className="grid sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: '3分で入力', desc: '施設情報・写真をオンラインで入力' },
              { step: '2', title: '審査', desc: '3営業日以内に担当者が確認' },
              { step: '3', title: '掲載開始', desc: '審査通過後すぐに掲載' },
              { step: '4', title: '集客スタート', desc: '求職者・患者に見つけてもらえる' },
            ].map((item, i) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 bg-primary">
                  {item.step}
                </div>
                <h3 className="font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
                {i < 3 && (
                  <div className="hidden sm:block text-primary text-2xl mt-4">&rarr;</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">よくある質問</h2>
          <FAQ items={faqItems} />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white">
        <div className="section-container text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">まずは無料で掲載登録</h2>
          <p className="text-gray-600 mb-8">最短3分で登録完了。費用は一切かかりません。</p>
          <Link href="/recruit" className="btn-primary text-lg">
            無料で掲載登録する
          </Link>
        </div>
      </section>
    </>
  );
}
