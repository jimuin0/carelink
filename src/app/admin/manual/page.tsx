import type { Metadata } from 'next';
import Link from 'next/link';
import PrintButton from './PrintButton';
import { SbPageHeader } from '@/components/admin/SbUi';
import { setupGuideSteps, SETUP_GROUP_LABELS, type SetupStepGroup } from '@/lib/facility-setup-steps';
import { LISTING_PUBLISH_REQUIREMENT } from '@/lib/register-photo-policy';

// admin/layout の title.template '%s | 管理画面 | CareLink' が自動付与するため、ここではページ名のみ（二重化防止）。
export const metadata: Metadata = { title: '操作マニュアル' };

type ManualSection = { id: string; title: string; content: { heading: string; body: string }[] };

const SECTIONS: ManualSection[] = [
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
        body: 'carelink-jp.com/auth/login にアクセスし、登録済みのメールアドレスとパスワードでログインしてください。店舗を管理できるアカウントは、ログイン後に管理画面のダッシュボードが開きます。',
      },
    ],
  },
  {
    id: 'bookings',
    title: '3. 予約管理',
    content: [
      {
        heading: '予約の確認',
        body: '「予約一覧」で予約を確認できます。スタッフごとの時間割で見るときは「予約表」を開きます。管理画面を開いている間に入った新しい予約は、画面右上でお知らせします。',
      },
      {
        heading: '予約の承認・お断り・ステータス変更',
        body: '予約を押すと詳細が開きます。確認待ちの予約は「承認する」または「お断りする」で対応します。承認後は「ステータス変更」のボタンで「受付」「完了」「キャンセル」などに変更できます。「設定」の「予約設定」で「予約を即時確定する」をオンにすると、承認の操作は不要になります。',
      },
      {
        heading: 'リマインド設定',
        body: 'ご来店日の前日の朝9時に、その時点のご予約へリマインドメールを自動で送信します（全プラン共通・無料）。「設定」のリマインダー設定で、7日前・3日前の朝9時にも送れます（3日前のメールとLINEでのリマインドは有料オプション）。前日の朝9時より後に入った翌日のご予約には、前日のリマインドは届きません。',
      },
      {
        heading: '退店・お会計とCareLinkポイント',
        body: 'お客様が予約時にCareLinkポイントを使った場合、予約詳細の金額欄と会計画面に「ポイント利用」として表示されます（変更・削除はできません）。明細の合計がポイント利用額を下回る会計は、差額のポイントがお客様に戻らないため確定できません。来店ポイント（お支払い額の1%）は、予約時の金額（メニュー料金＋指名料−クーポン、ポイント利用前）が上限で、会計で追加した物販などは対象外です。価格を設定していないメニュー（要相談など）の予約と、施設のオーナー・管理者ご本人の予約には来店ポイントは付きません。',
      },
    ],
  },
  {
    id: 'customers',
    title: '4. 顧客管理',
    content: [
      {
        heading: '顧客一覧',
        body: '「顧客」から予約したことのあるお客様の一覧を確認できます。来店履歴・施術記録も確認できます（お客様のCareLinkポイントの残高・履歴は、お客様ご本人だけが確認できます）。',
      },
      {
        heading: 'メモ・カルテ',
        body: 'お客様ごとに「メモ・カルテ」欄があります。施術内容や次回のご要望などを記録しておくと、次のご来店時に役立ちます。',
      },
    ],
  },
  {
    id: 'marketing',
    title: '5. 集客・マーケティング',
    content: [
      {
        heading: 'クーポン発行',
        body: '「クーポン」の「新規作成」で割引クーポンを作成できます。対象（全員・新規・リピーター・期間限定）と割引の種類（定額割引・割合割引・特別価格）を選べます。',
      },
      {
        heading: 'ブログ記事',
        body: '「ブログ」の「新規作成」で記事を投稿できます。地域名やお悩みの名前を含む記事は、検索からの集客に役立ちます。',
      },
      {
        heading: 'QRコード',
        body: '「QRコード」で施設ページのQRコードを作れます。印刷して店頭やショップカードに載せると、次回のご予約につながります。',
      },
    ],
  },
  {
    id: 'analytics',
    title: '6. 分析',
    content: [
      {
        heading: '売上分析',
        body: '「分析」で月別の売上・スタッフ別の売上などを確認できます。ページ閲覧から予約までの流れは「ファネル」で確認できます。',
      },
      {
        heading: '会計ソフト用の書き出し',
        body: '「会計連携」で、完了した予約を会計ソフト用のCSVで書き出せます。',
      },
    ],
  },
];

/** 初期設定の手順。チェックリスト（ダッシュボード）と同じ項目・同じ順で、facility-setup-steps から作る。 */
const SETUP_SECTION = { id: 'setup', title: '2. 初期設定' };
const SETUP_GROUPS: SetupStepGroup[] = ['listing', 'booking'];

function SetupSection() {
  // 番号はチェックリストの並び（掲載 → ネット予約）の通し番号。
  const steps = setupGuideSteps().map((step, index) => ({ ...step, number: index + 1 }));
  return (
    <div id={SETUP_SECTION.id} className="bg-white rounded-xl border p-6 space-y-5">
      <h2 className="text-lg font-bold text-gray-900">{SETUP_SECTION.title}</h2>
      <p className="text-sm text-gray-600 leading-relaxed">
        ダッシュボードの「店舗セットアップ」と同じ順に進めます。{LISTING_PUBLISH_REQUIREMENT}ネット予約を受けるには、さらにメニュー・写真・勤務時間を保存したスタッフが必要です（掲載だけの利用なら不要です）。
      </p>
      {SETUP_GROUPS.map((group) => (
        <section key={group} aria-label={SETUP_GROUP_LABELS[group]} className="space-y-4">
          <h3 className="text-sm font-bold text-sky-800">{SETUP_GROUP_LABELS[group]}</h3>
          {steps.filter((step) => step.group === group).map((step) => (
            <div key={step.key}>
              <h4 className="font-semibold text-gray-800 text-sm">ステップ{step.number}: {step.label}</h4>
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">{step.howto}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const TOC: { id: string; title: string }[] = [SECTIONS[0], SETUP_SECTION, ...SECTIONS.slice(1)];

function renderSection(section: ManualSection) {
  return (
    <div key={section.id} id={section.id} className="bg-white rounded-xl border p-6 space-y-5">
      <h2 className="text-lg font-bold text-gray-900">{section.title}</h2>
      {section.content.map((item) => (
        <div key={item.heading}>
          <h3 className="font-semibold text-gray-800 text-sm">{item.heading}</h3>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function ManualPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <SbPageHeader
        title="操作マニュアル"
        description="CareLink管理画面の操作方法をご確認いただけます"
        actions={<PrintButton />}
      />

      {/* Table of contents */}
      <div className="bg-sky-50 rounded-xl p-5">
        <h2 className="font-semibold text-sky-800 mb-3">目次</h2>
        <ol className="space-y-1">
          {TOC.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-sky-700 hover:underline text-sm">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* Sections（2. 初期設定だけは単一ソースから作る） */}
      {renderSection(SECTIONS[0])}
      <SetupSection />
      {SECTIONS.slice(1).map(renderSection)}

      {/* Support */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-2">お困りの際は</h2>
        <p className="text-sm text-gray-600">
          マニュアルに記載のない操作方法や不明点は、管理画面右下の「AIサポート」チャットか、
          問い合わせフォームからご連絡ください。
        </p>
        <div className="mt-3 flex gap-3">
          {/* 監査対応: /admin/inquiries はプラットフォーム運営者専用の問い合わせ管理ダッシュボード
              (contactsテーブルはprofiles.role='admin'限定のRLS)で、施設オーナーがアクセスしても
              常に空表示になる死んだ導線だった。施設オーナー向けの実際の問い合わせ窓口は/contact。 */}
          <Link href="/contact" className="text-sm text-sky-600 hover:underline">
            問い合わせフォーム →
          </Link>
        </div>
      </div>
    </div>
  );
}
