import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'プレミアムプラン | CareLink',
  description: 'CareLink プレミアムプランで集客力を最大化。優先表示・高度分析・カスタムドメイン・無制限スタッフ登録など上位機能をご利用いただけます。',
  alternates: { canonical: '/salon/premium' },
};

const FREE_FEATURES = [
  '施設ページ掲載（公開）',
  'オンライン予約機能',
  '口コミ・レビュー収集',
  'メニュー・スタッフ登録（各10件）',
  'クーポン発行（月3枚）',
  'LINE予約通知',
  '月次売上レポート',
  '顧客管理（50名まで）',
];

const PREMIUM_FEATURES = [
  '検索結果の優先表示（上位固定）',
  'メニュー・スタッフ無制限登録',
  'クーポン発行無制限',
  '顧客管理無制限',
  '高度分析ダッシュボード（RFM・ファネル）',
  'カスタムドメイン対応',
  'AIレビュー要約（月100件）',
  'チェーン店一括管理（複数施設）',
  'A/Bテスト機能',
  'NPS調査ツール',
  'Stripe決済統合（デポジット・事前決済）',
  '専任サポート（ビデオ通話対応）',
  'APIアクセス（POS・会計ソフト連携）',
  'ホワイトラベル（施設独自ドメイン）',
];

const PLANS = [
  {
    key: 'free',
    name: 'フリー',
    price: 0,
    unit: '永久無料',
    badge: null,
    color: 'border-gray-200',
    headerColor: 'bg-gray-50',
    buttonClass: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    buttonLabel: '無料で始める',
    buttonHref: '/register',
    description: '小規模サロン・まず試したい方へ',
    features: FREE_FEATURES,
  },
  {
    key: 'standard',
    name: 'スタンダード',
    price: 9800,
    unit: '/ 月（税込）',
    badge: 'おすすめ',
    color: 'border-sky-400 ring-2 ring-sky-300',
    headerColor: 'bg-sky-500 text-white',
    buttonClass: 'bg-sky-500 text-white hover:bg-sky-600',
    buttonLabel: '14日間無料体験',
    buttonHref: '/contact?plan=standard',
    description: '成長中のサロン・チェーン店向け',
    features: [
      '検索結果の優先表示（上位固定）',
      'メニュー・スタッフ無制限登録',
      'クーポン発行無制限',
      '顧客管理無制限',
      '高度分析ダッシュボード',
      'AIレビュー要約（月100件）',
      'チェーン店一括管理（5施設まで）',
      'A/Bテスト機能',
      'NPS調査ツール',
      'Stripe決済統合',
      'メールサポート（24h以内返信）',
    ],
  },
  {
    key: 'enterprise',
    name: 'エンタープライズ',
    price: null,
    unit: '個別見積もり',
    badge: 'カスタム',
    color: 'border-violet-400',
    headerColor: 'bg-violet-600 text-white',
    buttonClass: 'bg-violet-600 text-white hover:bg-violet-700',
    buttonLabel: 'お問い合わせ',
    buttonHref: '/contact?plan=enterprise',
    description: 'フランチャイズ・大規模チェーン向け',
    features: PREMIUM_FEATURES,
  },
];

const COMPARISON_ITEMS = [
  { label: '施設ページ公開', free: true, standard: true, enterprise: true },
  { label: 'オンライン予約', free: true, standard: true, enterprise: true },
  { label: '口コミ収集', free: true, standard: true, enterprise: true },
  { label: 'LINE通知', free: true, standard: true, enterprise: true },
  { label: 'メニュー登録数', free: '10件', standard: '無制限', enterprise: '無制限' },
  { label: '顧客管理', free: '50名', standard: '無制限', enterprise: '無制限' },
  { label: '検索優先表示', free: false, standard: true, enterprise: true },
  { label: 'Stripe決済統合', free: false, standard: true, enterprise: true },
  { label: '高度分析', free: false, standard: true, enterprise: true },
  { label: 'AIレビュー要約', free: false, standard: true, enterprise: true },
  { label: 'チェーン一括管理', free: false, standard: '5施設', enterprise: '無制限' },
  { label: 'カスタムドメイン', free: false, standard: false, enterprise: true },
  { label: 'APIアクセス', free: false, standard: false, enterprise: true },
  { label: 'ホワイトラベル', free: false, standard: false, enterprise: true },
  { label: '専任サポート', free: false, standard: false, enterprise: true },
];

function Check({ ok }: { ok: boolean | string }) {
  if (typeof ok === 'string') return <span className="text-sm font-medium text-gray-800">{ok}</span>;
  if (ok) return (
    <svg className="w-5 h-5 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  );
  return <span className="text-gray-300 text-lg leading-none">—</span>;
}

export default function PremiumPage() {
  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-700 to-violet-700 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-sky-200 text-sm font-medium mb-3 tracking-widest uppercase">CareLink Premium</p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
            集客力を最大化する<br />
            <span className="text-amber-300">プレミアム機能</span>
          </h1>
          <p className="text-sky-100 text-lg mb-8 max-w-2xl mx-auto">
            検索上位固定・無制限顧客管理・Stripe決済統合・AI分析など、
            成長を加速するすべての機能がワンパッケージ。
          </p>
          <Link href="/contact?plan=standard"
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-sky-700 font-bold rounded-xl text-lg hover:bg-sky-50 transition-all shadow-lg">
            14日間無料体験を始める
          </Link>
          <p className="text-sky-200 text-xs mt-3">クレジットカード不要 ・ いつでもキャンセル可</p>
        </div>
      </section>

      {/* Plans */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">料金プラン</h2>
        <div className="grid md:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan) => (
            <div key={plan.key} className={`bg-white rounded-2xl border-2 ${plan.color} overflow-hidden`}>
              <div className={`px-6 py-5 ${plan.headerColor}`}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-lg">{plan.name}</h3>
                  {plan.badge && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/20 border border-white/30">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <p className={`text-xs mb-3 ${plan.key === 'standard' ? 'text-sky-100' : plan.key === 'enterprise' ? 'text-violet-200' : 'text-gray-500'}`}>
                  {plan.description}
                </p>
                <div className="flex items-baseline gap-1">
                  {plan.price !== null ? (
                    <>
                      <span className="text-3xl font-bold">¥{plan.price.toLocaleString()}</span>
                      <span className={`text-sm ${plan.key === 'free' ? 'text-gray-500' : 'opacity-80'}`}>{plan.unit}</span>
                    </>
                  ) : (
                    <span className="text-xl font-bold">{plan.unit}</span>
                  )}
                </div>
              </div>
              <div className="p-6">
                <Link href={plan.buttonHref}
                  className={`block w-full py-3 rounded-xl font-bold text-center text-sm transition-colors ${plan.buttonClass}`}>
                  {plan.buttonLabel}
                </Link>
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                      <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">機能比較</h2>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-gray-500 font-medium w-1/2">機能</th>
                <th className="text-center px-3 py-3 text-gray-700 font-bold">フリー</th>
                <th className="text-center px-3 py-3 text-sky-600 font-bold bg-sky-50">スタンダード</th>
                <th className="text-center px-3 py-3 text-violet-700 font-bold">エンタープライズ</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ITEMS.map((item, i) => (
                <tr key={item.label} className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                  <td className="px-5 py-3 text-gray-800">{item.label}</td>
                  <td className="px-3 py-3 text-center"><Check ok={item.free} /></td>
                  <td className="px-3 py-3 text-center bg-sky-50/30"><Check ok={item.standard} /></td>
                  <td className="px-3 py-3 text-center"><Check ok={item.enterprise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">よくある質問</h2>
        <div className="space-y-4">
          {[
            { q: '無料体験後はどうなりますか？', a: '14日間の無料体験終了後、プレミアムを継続する場合は決済情報をご登録ください。自動更新はされませんので、安心して体験いただけます。' },
            { q: 'フリープランからいつでも移行できますか？', a: 'はい。管理画面からワンクリックで移行できます。フリープランのデータはすべて引き継がれます。' },
            { q: '施設が複数ある場合の料金は？', a: 'スタンダードプランは1施設分の料金です。5施設を超える場合や一括管理が必要な場合は、エンタープライズプランをご検討ください。' },
            { q: '途中解約はできますか？', a: 'いつでも解約可能です。解約後は月末まで利用継続でき、違約金は一切かかりません。' },
          ].map((item) => (
            <details key={item.q} className="bg-white rounded-xl border border-gray-100 p-5 group">
              <summary className="font-medium text-gray-800 cursor-pointer list-none flex items-center justify-between">
                {item.q}
                <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <p className="text-sm text-gray-600 mt-3">{item.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-10 bg-gradient-to-r from-sky-50 to-violet-50 rounded-2xl p-8 text-center border border-sky-100">
          <h3 className="text-xl font-bold text-gray-900 mb-2">まずは無料で始めてみませんか？</h3>
          <p className="text-gray-600 text-sm mb-6">フリープランで使い心地を確かめてから、プレミアムにアップグレードできます。</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register"
              className="px-6 py-3 bg-sky-500 text-white font-bold rounded-xl hover:bg-sky-600 transition-colors">
              無料で施設を掲載する
            </Link>
            <Link href="/contact?plan=premium"
              className="px-6 py-3 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-colors">
              プレミアムについて相談する
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
