import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

const faqItems = [
  {
    category: 'はじめに',
    items: [
      { q: '店舗情報を公開するには？', a: '「設定」→ 基本情報を入力 → メニュー・写真を最低1つ登録 →「公開する」ボタンをクリック。' },
      { q: 'スタッフのスケジュールを設定するには？', a: '「スタッフ」→ スタッフ名の「スケジュール」リンク → 曜日別に勤務時間を設定 →「保存」。' },
      { q: 'メニューを追加するには？', a: '「メニュー」→ カテゴリ・名前・価格・施術時間を入力 → 保存。写真もアップロード可能。' },
    ],
  },
  {
    category: '予約管理',
    items: [
      { q: '予約の承認/却下はどこで？', a: '「予約」→ 確認待ちの予約をクリック →「確定」or「却下」ボタン。' },
      { q: 'サロンボード（カレンダー）の見方は？', a: '上部ナビの「ボード」（サロンボード）。スタッフ×時間のガントチャートで一日の予約の流れを確認・操作できます。' },
      { q: '無断キャンセルの扱いは？', a: '予約詳細から「no_show」ステータスに変更可能。キャンセルポリシーは「設定」から設定。' },
    ],
  },
  {
    category: '集客・分析',
    items: [
      { q: '売上データはどこで見る？', a: '「分析」→ 日別売上グラフ、予約数推移、スタッフ別売上、顧客セグメントを確認。' },
      { q: 'クーポンの作り方は？', a: '「クーポン」→「新規作成」→ タイプ（新規/リピート/期間限定/全員）を選択 → 割引内容を設定。' },
      { q: 'LINE通知はどう設定する？', a: '「設定」→ LINE通知設定セクション。予約/キャンセル/リマインドのON/OFFを切替。' },
    ],
  },
  {
    category: 'アカウント・その他',
    items: [
      { q: '掲載を一時停止するには？', a: '「設定」→ ページ上部の「非公開にする」ボタン。いつでも再公開可能。' },
      { q: '退会・データ削除は？', a: '「設定」ページ下部の「退会・データ削除」から行えます。退会すると施設は非公開になり、アカウントと個人データが削除されます（取り消し不可）。未完了の予約が残っている間は退会できないため、予約の完了またはキャンセル後に行ってください。' },
      { q: '料金はかかりますか？', a: '基本機能は全て無料です。今後有料プランを検討する場合は事前にお知らせします。' },
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
