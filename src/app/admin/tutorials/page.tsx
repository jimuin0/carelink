import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ビデオチュートリアル | 管理画面 | CareLink' };

const TUTORIALS = [
  {
    category: '基本設定',
    videos: [
      { title: '施設情報を設定する', duration: '3:45', youtubeId: 'dQw4w9WgXcQ', desc: '基本情報・営業時間・アクセス情報の設定方法' },
      { title: 'スタッフを登録する', duration: '2:30', youtubeId: 'dQw4w9WgXcQ', desc: 'スタッフ情報の追加・シフト設定方法' },
      { title: 'メニューを追加する', duration: '4:15', youtubeId: 'dQw4w9WgXcQ', desc: 'メニュー・料金・所要時間の設定方法' },
    ],
  },
  {
    category: '予約管理',
    videos: [
      { title: '予約の確認・対応', duration: '5:00', youtubeId: 'dQw4w9WgXcQ', desc: '予約一覧の確認・承認・キャンセル方法' },
      { title: 'カレンダー設定', duration: '3:20', youtubeId: 'dQw4w9WgXcQ', desc: '休日・臨時休業・営業時間変更の設定' },
    ],
  },
  {
    category: '集客・マーケティング',
    videos: [
      { title: 'クーポンを作成する', duration: '2:50', youtubeId: 'dQw4w9WgXcQ', desc: '割引クーポンの作成・有効期限設定' },
      { title: 'ブログ記事を書く', duration: '4:00', youtubeId: 'dQw4w9WgXcQ', desc: 'SEO効果の高いブログ記事の書き方' },
      { title: 'QRコードを活用する', duration: '1:45', youtubeId: 'dQw4w9WgXcQ', desc: 'QRコードの作成・店頭掲示方法' },
    ],
  },
  {
    category: '分析・改善',
    videos: [
      { title: 'アクセス解析を見る', duration: '3:30', youtubeId: 'dQw4w9WgXcQ', desc: '閲覧数・予約率・離脱ポイントの確認方法' },
      { title: '口コミへの返信', duration: '2:15', youtubeId: 'dQw4w9WgXcQ', desc: '口コミ返信のベストプラクティス' },
    ],
  },
];

export default function TutorialsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ビデオチュートリアル</h1>
        <p className="text-sm text-gray-500 mt-1">CareLink管理画面の使い方を動画でご確認いただけます</p>
      </div>

      {TUTORIALS.map((section) => (
        <div key={section.category}>
          <h2 className="font-semibold text-gray-900 mb-4 pb-2 border-b">{section.category}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {section.videos.map((video) => (
              <div key={video.title} className="bg-white rounded-xl border overflow-hidden hover:border-sky-200 transition-colors group">
                <div className="relative aspect-video bg-gray-900">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
                    title={video.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                  />
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
        <a
          href="/admin/inquiries/new"
          className="inline-block mt-3 text-sm text-sky-600 hover:text-sky-700 underline"
        >
          リクエストを送る →
        </a>
      </div>
    </div>
  );
}
