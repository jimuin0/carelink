import Link from 'next/link';

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 to-white">
        <div className="section-container text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6 leading-tight">
            医療・福祉・美容の
            <br />
            <span style={{ color: 'var(--primary)' }}>採用×集客</span>プラットフォーム
          </h1>
          <p className="text-gray-600 text-lg sm:text-xl mb-10 max-w-2xl mx-auto">
            施設の集客も、転職活動も。
            <br />
            CareLink がすべてをつなぎます。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/salon" className="btn-primary text-lg">
              施設・サロンの方はこちら
            </Link>
            <Link href="/jobs" className="btn-outline text-lg">
              求職者の方はこちら
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">CareLink の特長</h2>
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

      {/* CTA */}
      <section style={{ backgroundColor: 'var(--primary)' }}>
        <div className="section-container text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">
            さっそく始めましょう
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/salon"
              className="inline-flex items-center justify-center px-8 py-4 bg-white font-bold rounded-lg transition-all hover:bg-gray-100"
              style={{ color: 'var(--primary)' }}
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
        </div>
      </section>
    </>
  );
}
