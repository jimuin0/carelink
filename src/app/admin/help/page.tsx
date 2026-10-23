import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';
import { ACCOUNT_DELETION_NOTICE, FACILITY_RETIREMENT_NOTICE, ACCOUNT_DELETION_BOOKING_GUARD_NOTICE } from '@/lib/account-deletion-policy';
import { LISTING_PUBLISH_REQUIREMENT } from '@/lib/register-photo-policy';

const faqItems = [
  {
    category: 'はじめに',
    items: [
      { q: '店舗情報を公開するには？', a: `${LISTING_PUBLISH_REQUIREMENT}「設定」で入力・保存してから、画面上部の「公開する」を押します。無料掲載にメニュー・写真・スタッフは必須ではありません。ネット予約の受付は、さらにメニュー・写真・スタッフ等の準備後に利用できます。` },
      { q: 'スタッフの勤務時間を設定するには？', a: '「スタッフ」の一覧で、そのスタッフの「スケジュール」（未登録なら「勤務時間を登録する」）を押し、曜日ごとの勤務時間を入れて「スケジュールを保存」を押します（初めての登録では「この勤務時間で保存する」）。勤務時間を保存するまで、そのスタッフはネット予約を受けられません。' },
      { q: 'メニューを追加するには？', a: '「メニュー」の「メニュー追加」で、カテゴリ・メニュー名・料金・所要時間を入力して「保存」を押します。写真も選べます（任意）。' },
    ],
  },
  {
    category: '予約管理',
    items: [
      { q: '予約の承認・お断りはどこで？', a: '「予約一覧」で確認待ちの予約を開き、「承認する」または「お断りする」を押します。' },
      { q: '予約表の見方は？', a: 'メニューの「予約表」を開くと、スタッフごとの一日の予約が時間の流れに沿って並びます。空いている時間を押すと、電話などで受けた予約をその場で入れられます。' },
      { q: '無断キャンセルの扱いは？', a: '予約の詳細を開き、「ステータス変更」の「無断キャンセル」を押します（予約の開始時刻を過ぎると選べます）。キャンセル料の割合は「設定」の「キャンセルポリシー」で決められます。' },
    ],
  },
  {
    category: '集客・分析',
    items: [
      { q: '売上データはどこで見る？', a: '「分析」で、月別売上・予約数の推移・顧客の内訳・スタッフ別の売上などを確認できます。' },
      { q: 'クーポンの作り方は？', a: '「クーポン」の「新規作成」で、対象（全員・新規・リピーター・期間限定）と割引の種類（定額割引・割合割引・特別価格）を選んで作成します。' },
      { q: '予約の通知はどう設定する？', a: '「設定」の「通知設定」で、新規予約・キャンセル・口コミのPush通知と、口コミ・日次売上サマリー・週次レポートのメールをそれぞれオン／オフできます。お客様へのリマインドは「リマインダー設定」で変更できます。' },
    ],
  },
  {
    category: 'アカウント・その他',
    items: [
      { q: '掲載を一時停止するには？', a: '「設定」の画面上部の「非公開にする」を押します。「公開する」でいつでも再公開できます。' },
      { q: '退会・データ削除は？', a: `「設定」ページ下部の「退会・データ削除」から行えます。${ACCOUNT_DELETION_NOTICE}${FACILITY_RETIREMENT_NOTICE}${ACCOUNT_DELETION_BOOKING_GUARD_NOTICE}` },
      { q: '料金はかかりますか？', a: '掲載と基本機能は無料です。必要な機能だけを月額で追加できる有料オプションがあり、内容と料金は「設定」の「有料オプション」に表示しています。' },
    ],
  },
];

export default function AdminHelpPage() {
  return (
    <div>
      <SbPageHeader title="ヘルプ・FAQ" />

      <div className="bg-sky-50 rounded-xl p-5 mb-6">
        <p className="text-sm text-sky-800">
          お困りのことがありましたら、下記FAQをご確認ください。
          解決しない場合は <Link href="/contact" className="text-sky-600 underline">お問い合わせフォーム</Link> からご連絡ください。
        </p>
      </div>

      <div className="space-y-8">
        {faqItems.map((section) => (
          <div key={section.category}>
            <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{section.category}</h2>
            <div className="space-y-2">
              {section.items.map((item) => (
                <details key={item.q} className="bg-white rounded-xl border border-gray-100">
                  <summary className="p-4 cursor-pointer text-sm font-medium text-gray-800 hover:bg-gray-50 rounded-xl list-none flex items-center justify-between">
                    {item.q}
                    <svg className="w-4 h-4 text-gray-400 shrink-0 transition-transform [[open]>&]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gray-600">{item.a}</div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
