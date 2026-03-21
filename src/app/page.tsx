import Link from 'next/link';
import FadeIn from '@/components/FadeIn';

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-sky-50">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-10 w-72 h-72 bg-sky-200 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-sky-100 rounded-full blur-3xl" />
        </div>
        <div className="section-container text-center relative z-10">
          <FadeIn>
            <p className="inline-block text-sm font-bold text-primary bg-sky-100 px-4 py-1.5 rounded-full mb-6">
              医療・福祉・美容 業界に特化
            </p>
          </FadeIn>
          <FadeIn delay={100}>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6 leading-tight">
              採用も、集客も。
              <br />
              <span className="text-primary">CareLink</span> がつなぎます。
            </h1>
          </FadeIn>
          <FadeIn delay={200}>
            <p className="text-gray-600 text-lg sm:text-xl mb-10 max-w-2xl mx-auto leading-relaxed">
              施設の集客から求職者のキャリアまで。
              <br className="hidden sm:block" />
              業界を知り尽くしたプラットフォームが最適なマッチングを実現します。
            </p>
          </FadeIn>
          <FadeIn delay={300}>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/salon" className="btn-primary text-lg">
                施設・サロンの方はこちら
              </Link>
              <Link href="/jobs" className="btn-outline text-lg">
                求職者の方はこちら
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Numbers */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <FadeIn>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
              {[
                { number: '0', unit: '円', label: '初期費用・月額費用' },
                { number: '3', unit: '分', label: 'かんたん登録' },
                { number: '5', unit: '業種+', label: '対応業種' },
                { number: '24', unit: 'h', label: 'いつでも登録可能' },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-3xl sm:text-4xl font-black text-primary">
                    {item.number}
                    <span className="text-lg font-bold ml-0.5">{item.unit}</span>
                  </p>
                  <p className="text-gray-500 text-sm mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* For Whom */}
      <section className="bg-white">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">こんな方におすすめ</h2>
          </FadeIn>
          <div className="grid sm:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <FadeIn delay={100}>
              <div className="card border-2 border-sky-100 hover:border-primary transition-colors h-full">
                <div className="text-center mb-6">
                  <span className="inline-flex items-center justify-center w-16 h-16 bg-sky-50 rounded-2xl text-3xl" role="img" aria-label="施設">
                    🏢
                  </span>
                </div>
                <h3 className="text-xl font-bold text-center mb-4">施設・サロン経営者の方</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    新規顧客をもっと増やしたい
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    採用コストを抑えたい
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    業界に理解のあるサービスを使いたい
                  </li>
                </ul>
                <Link href="/salon" className="btn-primary w-full mt-6 text-base">
                  無料で施設を掲載する
                </Link>
              </div>
            </FadeIn>

            <FadeIn delay={200}>
              <div className="card border-2 border-sky-100 hover:border-primary transition-colors h-full">
                <div className="text-center mb-6">
                  <span className="inline-flex items-center justify-center w-16 h-16 bg-sky-50 rounded-2xl text-3xl" role="img" aria-label="求職者">
                    👤
                  </span>
                </div>
                <h3 className="text-xl font-bold text-center mb-4">転職を考えている方</h3>
                <ul className="space-y-3 text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    自分のスキルを活かせる職場を探したい
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    条件に合った求人だけを受け取りたい
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">&#10003;</span>
                    まずは情報収集だけしたい
                  </li>
                </ul>
                <Link href="/jobs" className="btn-outline w-full mt-6 text-base">
                  無料で求職者登録する
                </Link>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">CareLink の特長</h2>
          </FadeIn>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: '🏥',
                title: '業界特化',
                desc: '医療・福祉・美容に特化しているから、ミスマッチのない集客・採用が可能です。',
              },
              {
                icon: '🤖',
                title: 'AIマッチング',
                desc: 'AIが施設と求職者を自動マッチング。最適な出会いを効率的に実現します。',
              },
              {
                icon: '💰',
                title: '完全無料',
                desc: '施設の掲載も求職者の登録も完全無料。費用を気にせず利用できます。',
              },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 100}>
                <div className="card text-center h-full">
                  <div className="text-4xl mb-4" role="img" aria-label={item.title}>{item.icon}</div>
                  <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                  <p className="text-gray-600">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">ご利用の流れ</h2>
          </FadeIn>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { step: '1', title: '無料登録', desc: 'フォームに必要事項を入力するだけ。3分で完了します。' },
              { step: '2', title: 'マッチング', desc: 'AIがあなたに最適な施設・求職者を自動でマッチングします。' },
              { step: '3', title: 'スタート', desc: '集客開始・応募開始。担当者がサポートします。' },
            ].map((item, i) => (
              <FadeIn key={item.step} delay={i * 150}>
                <div className="text-center relative">
                  <div className="w-14 h-14 rounded-full bg-primary text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                    {item.step}
                  </div>
                  <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                  <p className="text-gray-600 text-sm">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Voices */}
      <section className="bg-gray-50">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">ご利用者の声</h2>
          </FadeIn>
          <div className="grid sm:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: 'A様',
                role: '美容サロン経営',
                text: '掲載してすぐに問い合わせが来ました。無料でここまでできるとは思いませんでした。',
              },
              {
                name: 'B様',
                role: '介護施設 採用担当',
                text: '業界に特化しているので、求めているスキルを持った方からの応募が多く助かっています。',
              },
              {
                name: 'C様',
                role: 'アイリスト（転職成功）',
                text: '自分の資格が正しく評価される職場が見つかりました。登録から2週間で内定をいただきました。',
              },
            ].map((item, i) => (
              <FadeIn key={item.name} delay={i * 100}>
                <div className="card h-full flex flex-col">
                  <div className="flex items-center gap-1 text-amber-400 mb-3">
                    {[...Array(5)].map((_, j) => (
                      <svg key={j} className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed flex-1">&ldquo;{item.text}&rdquo;</p>
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="font-bold text-sm">{item.name}</p>
                    <p className="text-gray-400 text-xs">{item.role}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="bg-white">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">安心してご利用いただけます</h2>
          </FadeIn>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {[
              { icon: '🔒', title: 'SSL暗号化通信', desc: 'すべての通信をSSLで暗号化。個人情報を安全に保護します。' },
              { icon: '🛡️', title: '個人情報保護', desc: '個人情報保護法に基づき、適切に管理・運用しています。' },
              { icon: '📞', title: 'サポート体制', desc: 'お問い合わせは2営業日以内にご返信。安心のサポート体制。' },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 100}>
                <div className="flex items-start gap-4 bg-gray-50 rounded-xl p-5">
                  <span className="text-2xl flex-shrink-0" role="img" aria-label={item.title}>{item.icon}</span>
                  <div>
                    <h3 className="font-bold mb-1">{item.title}</h3>
                    <p className="text-gray-600 text-sm">{item.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50">
        <div className="section-container">
          <FadeIn>
            <h2 className="section-title">よくある質問</h2>
          </FadeIn>
          <div className="max-w-3xl mx-auto space-y-4">
            {[
              { q: '本当に無料ですか？', a: 'はい、施設の掲載も求職者の登録も完全無料です。初期費用・月額費用は一切かかりません。' },
              { q: 'どんな業種が対象ですか？', a: '美容サロン・アイラッシュ、鍼灸院、整骨院、介護施設・デイサービス、病院・クリニックなど、医療・福祉・美容業界に幅広く対応しています。' },
              { q: '登録後、すぐに利用開始できますか？', a: '登録後、2営業日以内に担当者よりご連絡いたします。内容を確認させていただいた後、すぐにサービスをご利用いただけます。' },
              { q: '途中で退会できますか？', a: 'いつでも退会可能です。退会後はすべてのデータを削除いたします。違約金等は一切かかりません。' },
            ].map((item, i) => (
              <FadeIn key={i} delay={i * 50}>
                <details className="group bg-white rounded-xl shadow-sm border border-gray-100">
                  <summary className="flex items-center justify-between p-5 cursor-pointer font-bold text-gray-800 text-sm sm:text-base">
                    <span>{item.q}</span>
                    <svg className="w-5 h-5 text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0 ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <p className="px-5 pb-5 text-gray-600 text-sm leading-relaxed">{item.a}</p>
                </details>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary">
        <div className="section-container text-center text-white">
          <FadeIn>
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              さっそく始めましょう
            </h2>
            <p className="text-white/80 mb-8 max-w-lg mx-auto">
              登録は無料・たった3分。あなたのビジネスとキャリアを次のステージへ。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/salon"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-primary font-bold rounded-lg transition-all hover:bg-gray-100"
              >
                無料で施設を掲載する
              </Link>
              <Link
                href="/jobs"
                className="inline-flex items-center justify-center px-8 py-4 bg-white/20 text-white font-bold rounded-lg border-2 border-white transition-all hover:bg-white/30"
              >
                無料で求職者登録する
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  );
}
