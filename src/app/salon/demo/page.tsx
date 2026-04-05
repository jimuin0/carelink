import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '管理画面デモ | CareLink',
  description: 'CareLinkの管理画面を紹介します。予約管理・顧客分析・メニュー管理・LINE通知など、全機能が無料で使えます。',
  alternates: { canonical: '/salon/demo' },
};

const features = [
  {
    title: 'ダッシュボード',
    desc: '今日の予約数・確認待ち・来店数をひと目で把握。',
    details: ['予約数サマリー', '確認待ちアラート', 'KPI表示'],
  },
  {
    title: '予約管理',
    desc: '予約の確認・承認・キャンセルをワンクリックで。予約台帳（ガントチャート）で一日の流れを可視化。',
    details: ['ステータスフィルタ', '予約台帳（ガントチャート）', 'CSV一括エクスポート'],
  },
  {
    title: '売上・顧客分析',
    desc: '日別売上チャート、予約数推移、顧客セグメント（VIP/常連/離脱リスク）を自動分析。',
    details: ['日別売上折れ線グラフ', '予約数推移バーチャート', '顧客セグメント円グラフ', 'リピート率カード', 'スタッフ別売上'],
  },
  {
    title: 'メニュー管理',
    desc: 'カテゴリ別にメニューを管理。写真・価格・施術時間を自由に設定。保険適用メニューにも対応。',
    details: ['カテゴリ別管理', '写真付きメニュー', '保険適用バッジ', '15カテゴリ対応'],
  },
  {
    title: 'スタッフ管理',
    desc: 'スタッフのプロフィール・指名料・シフトを管理。指名予約に対応。',
    details: ['指名料設定', 'シフト管理', 'ポートフォリオ掲載', 'SNSリンク'],
  },
  {
    title: 'クーポン管理',
    desc: '新規限定・リピーター向け・期間限定など、タイプ別のクーポンを発行。',
    details: ['新規/リピート/期間限定/全員', '割引率・固定額・特別価格', '対象メニュー指定'],
  },
  {
    title: 'LINE通知',
    desc: '予約確認・リマインド・キャンセルをLINEで自動通知。HPBにはない機能。',
    details: ['予約確認通知', 'リマインド通知', 'キャンセル通知', 'フォロー自動応答'],
  },
  {
    title: 'リアルタイム通知',
    desc: '新規予約が入ったら即座にPush通知。見逃しゼロ。',
    details: ['Web Push通知', 'ブラウザ内トースト通知', 'メール通知設定'],
  },
  {
    title: '口コミ管理',
    desc: '口コミの公開/非公開切替、サロン返信機能。お客様の声を集客に活用。',
    details: ['公開/非公開切替', 'サロン返信', '写真付き口コミ', '来店確認バッジ'],
  },
  {
    title: '施設設定',
    desc: '基本情報・営業時間・特徴タグ・公開/非公開をいつでも変更可能。',
    details: ['ワンクリック公開/非公開', '営業時間曜日別設定', '16種類の特徴タグ'],
  },
];

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            CareLink 管理画面でできること
          </h1>
          <p className="text-sky-100 text-lg mb-8">
            HPBと同等以上の機能が、全部無料で使えます
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="space-y-8">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`flex flex-col sm:flex-row gap-6 p-6 rounded-2xl ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white border border-gray-100'}`}
            >
              <div className="sm:w-16 shrink-0">
                <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-lg">
                  {i + 1}
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-800 mb-2">{f.title}</h2>
                <p className="text-sm text-gray-600 mb-3">{f.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {f.details.map((d) => (
                    <span key={d} className="px-2.5 py-1 bg-sky-50 text-sky-700 text-xs rounded-full">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-sky-600 to-sky-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-2xl font-bold mb-4">全部無料。今すぐ始められます。</h2>
          <p className="text-sky-100 mb-8">登録3分 ・ クレジットカード不要 ・ いつでも解約可</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register" className="inline-flex items-center justify-center px-8 py-4 bg-white text-sky-700 font-bold rounded-lg text-lg hover:bg-sky-50 transition-all shadow-lg">
              無料で掲載登録する
            </Link>
            <Link href="/salon" className="inline-flex items-center justify-center px-8 py-4 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-all">
              HPBとの比較を見る
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
