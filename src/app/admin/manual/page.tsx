import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '操作マニュアル | 管理画面 | CareLink' };

const SECTIONS = [
  {
    id: 'getting-started',
    title: '1. はじめに',
    content: [
      {
        heading: 'CareLink管理画面とは',
        body: 'CareLink管理画面では、施設情報の編集・予約管理・顧客管理・分析など、施設運営に必要なすべての機能を管理できます。',
      },
      {
        heading: 'ログイン方法',
        body: 'carelink-jp.com/auth/login にアクセスし、登録済みのメールアドレスとパスワードでログインしてください。ログイン後は自動的に管理画面トップページに移動します。',
      },
    ],
  },
  {
    id: 'setup',
    title: '2. 初期設定（5ステップ）',
    content: [
      {
        heading: 'ステップ1: メニューを登録する',
        body: '「管理画面 → メニュー → 新規作成」から施術メニュー・価格・所要時間を登録します。最低1つ以上のメニューが必要です。',
      },
      {
        heading: 'ステップ2: スタッフを登録する',
        body: '「管理画面 → スタッフ → 新規追加」からスタッフ情報・担当メニュー・シフトを設定します。',
      },
      {
        heading: 'ステップ3: 写真をアップロードする',
        body: '「管理画面 → 写真」から施設写真を5枚以上アップロードしてください。写真が多いほど予約率が上がります。',
      },
      {
        heading: 'ステップ4: 営業スケジュールを設定する',
        body: '「管理画面 → 設定 → 営業時間」から各曜日の営業時間・定休日を設定します。',
      },
      {
        heading: 'ステップ5: 施設を公開する',
        body: '「管理画面 → 設定 → 公開設定」から「公開中」に変更すると、検索結果に施設が表示されます。',
      },
    ],
  },
  {
    id: 'bookings',
    title: '3. 予約管理',
    content: [
      {
        heading: '予約の確認',
        body: '「管理画面 → 予約」から全予約を確認できます。新着予約は通知バッジで表示されます。',
      },
      {
        heading: '予約の承認・キャンセル',
        body: '各予約をクリックすると詳細が表示されます。「確定」「キャンセル」ボタンで対応できます。自動確定モードに設定すると手動承認が不要になります。',
      },
      {
        heading: 'リマインド設定',
        body: '予約確定後、24時間前に自動でリマインドメールが送信されます（Cron設定済み）。',
      },
    ],
  },
  {
    id: 'customers',
    title: '4. 顧客管理',
    content: [
      {
        heading: '顧客一覧',
        body: '「管理画面 → 顧客」から予約したことのあるお客様の一覧を確認できます。来店履歴・施術記録・ポイント残高も確認できます。',
      },
      {
        heading: 'メモ・施術記録',
        body: '各顧客ページに「施術メモ」欄があります。施術内容・症状・体調などを記録しておくと次回来店時に役立ちます。',
      },
    ],
  },
  {
    id: 'marketing',
    title: '5. 集客・マーケティング',
    content: [
      {
        heading: 'クーポン発行',
        body: '「管理画面 → クーポン → 新規作成」から割引クーポンを作成できます。初回限定・期間限定など条件を設定できます。',
      },
      {
        heading: 'ブログ記事',
        body: '「管理画面 → ブログ → 新規作成」でSEO対策記事を投稿できます。地域名・症状名を含む記事が検索からの集客に効果的です。',
      },
      {
        heading: 'QRコード',
        body: '「管理画面 → QRコード」から施設ページのQRコードを生成できます。店頭に貼っておくとリピート率が上がります。',
      },
    ],
  },
  {
    id: 'analytics',
    title: '6. 分析',
    content: [
      {
        heading: 'アクセス解析',
        body: '「管理画面 → 分析」からページビュー・予約完了率・離脱ポイントを確認できます。',
      },
      {
        heading: '売上レポート',
        body: '月次・週次の予約数・売上を確認できます。CSV形式でエクスポートも可能です（freee/MoneyForward連携対応）。',
      },
    ],
  },
];

export default function ManualPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">操作マニュアル</h1>
          <p className="text-sm text-gray-500 mt-1">CareLink管理画面の操作方法をご確認いただけます</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 text-sm border px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          印刷/PDF保存
        </button>
      </div>

      {/* Table of contents */}
      <div className="bg-sky-50 rounded-xl p-5">
        <h2 className="font-semibold text-sky-800 mb-3">目次</h2>
        <ol className="space-y-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-sky-700 hover:underline text-sm">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => (
        <div key={section.id} id={section.id} className="bg-white rounded-xl border p-6 space-y-5">
          <h2 className="text-lg font-bold text-gray-900">{section.title}</h2>
          {section.content.map((item, i) => (
            <div key={i}>
              <h3 className="font-semibold text-gray-800 text-sm">{item.heading}</h3>
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      ))}

      {/* Support */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-2">お困りの際は</h2>
        <p className="text-sm text-gray-600">
          マニュアルに記載のない操作方法や不明点は、管理画面右下の「AIサポート」チャットか、
          問い合わせフォームからご連絡ください。
        </p>
        <div className="mt-3 flex gap-3">
          <Link href="/admin/inquiries" className="text-sm text-sky-600 hover:underline">
            問い合わせフォーム →
          </Link>
          <Link href="/admin/tutorials" className="text-sm text-sky-600 hover:underline">
            ビデオチュートリアル →
          </Link>
        </div>
      </div>
    </div>
  );
}
