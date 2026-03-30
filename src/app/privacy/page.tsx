import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description: 'CareLinkの個人情報の取扱い方針について。収集する情報・利用目的・第三者提供・安全管理措置等を定めています。',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="section-container">
      <div className="max-w-3xl mx-auto prose prose-gray">
        <h1 className="text-3xl font-bold mb-8">プライバシーポリシー</h1>

        <p className="text-gray-600 mb-8">
          神原良祐（以下「当事業者」）は、CareLink（以下「本サービス」）における個人情報の取扱いについて、以下のとおりプライバシーポリシーを定めます。
        </p>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第1条（事業者情報）</h2>
          <ul className="text-gray-600 space-y-1">
            <li>事業者名：神原良祐（個人事業主）</li>
            <li>所在地：大阪府豊中市</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第2条（取得する個人情報）</h2>
          <p className="text-gray-600 mb-2">当事業者は、本サービスの提供にあたり、以下の個人情報を取得します。</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>氏名、フリガナ</li>
            <li>メールアドレス</li>
            <li>電話番号</li>
            <li>住所、郵便番号</li>
            <li>生年月日、性別</li>
            <li>職歴、資格、学歴等の経歴情報</li>
            <li>施設情報（施設名、業種、営業時間等）</li>
            <li>写真（施設写真、顔写真）</li>
            <li>お問い合わせ内容</li>
            <li>Cookie、アクセスログ等の利用情報</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第3条（利用目的）</h2>
          <p className="text-gray-600 mb-2">取得した個人情報は、以下の目的で利用します。</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>本サービスの提供・運営</li>
            <li>施設情報の掲載および利用者への情報提供</li>
            <li>お問い合わせへの対応</li>
            <li>サービス改善のための分析</li>
            <li>重要なお知らせの通知</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第4条（第三者提供）</h2>
          <p className="text-gray-600">
            当事業者は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供することはありません。ただし、本サービスにおいて、施設情報を利用者に公開する場合があります。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第5条（個人情報の管理）</h2>
          <p className="text-gray-600">
            当事業者は、個人情報の正確性を保ち、不正アクセス・紛失・破損・改ざん・漏洩等を防止するため、SSL暗号化通信およびSupabaseによるセキュアなデータベース管理を実施しています。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第6条（開示・訂正・削除の請求）</h2>
          <p className="text-gray-600">
            ご本人から個人情報の開示・訂正・削除等のご請求があった場合は、本人確認の上、速やかに対応いたします。下記のお問い合わせ窓口までご連絡ください。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第7条（Cookie・分析ツールの使用）</h2>
          <p className="text-gray-600 mb-2">
            本サービスでは、利便性向上およびアクセス解析のため、以下のツールを使用しています。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>Google Analytics 4（GA4）：アクセス解析</li>
            <li>Microsoft Clarity：ユーザー行動分析（ヒートマップ・セッション録画）</li>
          </ul>
          <p className="text-gray-600 mt-2">
            これらのツールはCookieを使用しますが、個人を特定する情報は含まれません。ブラウザの設定によりCookieの受け取りを拒否することができます。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第8条（プライバシーポリシーの変更）</h2>
          <p className="text-gray-600">
            当事業者は、必要に応じて本ポリシーを変更することがあります。変更後のポリシーは、本ページに掲載した時点から効力を生じるものとします。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第9条（お問い合わせ窓口）</h2>
          <p className="text-gray-600">
            個人情報の取扱いに関するお問い合わせは、
            <Link href="/contact" className="text-primary hover:underline">お問い合わせページ</Link>
            よりご連絡ください。
          </p>
        </section>

        <p className="text-gray-500 text-sm">制定日：2026年3月19日</p>
      </div>
    </div>
  );
}
