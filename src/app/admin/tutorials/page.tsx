import type { Metadata } from 'next';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

export const metadata: Metadata = { title: 'ビデオチュートリアル | 管理画面 | CareLink' };

const TUTORIALS = [
  {
    category: '基本設定',
    videos: [
      { title: '施設情報を設定する', duration: '3:45', desc: '基本情報・営業時間・アクセス情報の設定方法' },
      { title: 'スタッフを登録する', duration: '2:30', desc: 'スタッフ情報の追加・シフト設定方法' },
      { title: 'メニューを追加する', duration: '4:15', desc: 'メニュー・料金・所要時間の設定方法' },
    ],
  },
  {
    category: '予約管理',
    videos: [
      { title: '予約の確認・対応', duration: '5:00', desc: '予約一覧の確認・承認・キャンセル方法' },
      { title: 'カレンダー設定', duration: '3:20', desc: '休日・臨時休業・営業時間変更の設定' },
    ],
  },
  {
    category: '集客・マーケティング',
    videos: [
      { title: 'クーポンを作成する', duration: '2:50', desc: '割引クーポンの作成・有効期限設定' },
      { title: 'ブログ記事を書く', duration: '4:00', desc: 'SEO効果の高いブログ記事の書き方' },
      { title: 'QRコードを活用する', duration: '1:45', desc: 'QRコードの作成・店頭掲示方法' },
    ],
  },
  {
    category: '分析・改善',
    videos: [
      { title: 'アクセス解析を見る', duration: '3:30', desc: '閲覧数・予約率・離脱ポイントの確認方法' },
      { title: '口コミへの返信', duration: '2:15', desc: '口コミ返信のベストプラクティス' },
    ],
  },
];

export default function TutorialsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <SbPageHeader title="ビデオチュートリアル" description="CareLink管理画面の使い方を動画でご確認いただけます" />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        動画は順次公開予定です。公開され次第この画面に掲載されます。
      </div>

      {TUTORIALS.map((section) => (
        <div key={section.category}>
          <h2 className="font-semibold text-gray-900 mb-4 pb-2 border-b">{section.category}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {section.videos.map((video) => (
              <div key={video.title} className="bg-white rounded-xl border overflow-hidden">
                <div className="relative aspect-video bg-gray-100 flex flex-col items-center justify-center gap-2">
                  <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-gray-400">準備中</span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-gray-900 text-sm leading-tight">{video.title}</h3>
                    <span className="text-xs text-gray-400 shrink-0">{video.duration}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{video.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-sky-50 rounded-xl p-6">
        <h3 className="font-semibold text-sky-800">チュートリアルのリクエスト</h3>
        <p className="text-sm text-sky-700 mt-1">
          「この機能の使い方が分からない」というご要望があればお知らせください。
          優先的に動画を制作いたします。
        </p>
        <Link
          href="/admin/inquiries"
          className="inline-block mt-3 text-sm text-sky-600 hover:text-sky-700 underline"
        >
          リクエストを送る →
        </Link>
      </div>
    </div>
  );
}
