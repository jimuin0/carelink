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
            <li>外部認証サービス（Google、LINE）から取得するアカウント情報（メールアドレス、表示名、プロフィール画像）</li>
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
            当事業者は、法令に基づく場合を除き、あらかじめ本人の同意を得ることなく個人情報を第三者に提供することはありません。ただし、本サービスにおいて利用者が任意に登録・公開した施設情報・プロフィール情報等は、サービスの性質上、第三者が閲覧可能となります。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第5条（業務委託および外国にある第三者への提供）</h2>
          <p className="text-gray-600 mb-2">
            当事業者は、サービス運営に必要な範囲で、以下の外部事業者に個人情報の取扱いを委託しています。これらの事業者には、個人情報保護法に基づく適切な監督を行います。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>Supabase, Inc.（米国）：データベースおよび認証基盤の提供</li>
            <li>Vercel Inc.（米国）：Webホスティングの提供</li>
            <li>Google LLC（米国）：アクセス解析（Google Analytics 4）および認証連携</li>
            <li>Microsoft Corporation（米国）：ユーザー行動分析（Microsoft Clarity）</li>
            <li>LINEヤフー株式会社（日本）：認証連携</li>
          </ul>
          <p className="text-gray-600 mt-2 text-sm">
            外国にある第三者への個人データの提供にあたっては、個人情報保護法第28条に基づき、移転先国の個人情報保護制度および当該事業者が講じる安全管理措置を確認のうえ提供しています。各国制度の詳細は、個人情報保護委員会ウェブサイトをご参照ください。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第6条（安全管理措置）</h2>
          <p className="text-gray-600 mb-2">
            当事業者は、取得した個人情報の漏えい・滅失・毀損の防止その他安全管理のため、以下の措置を講じます。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1 text-sm">
            <li>組織的安全管理措置：個人情報取扱責任者の設置、取扱状況の点検</li>
            <li>人的安全管理措置：従業者・委託先に対する秘密保持義務の徹底</li>
            <li>物理的安全管理措置：個人情報を取り扱う端末・記録媒体の管理</li>
            <li>技術的安全管理措置：SSL/TLSによる通信暗号化、アクセス制御、認証管理、データベースの行レベルセキュリティ（RLS）の適用</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第7条（保有個人データの開示・訂正・利用停止等の請求）</h2>
          <p className="text-gray-600 mb-2">
            ご本人またはその代理人から、個人情報保護法に基づく保有個人データの利用目的の通知、開示、内容の訂正・追加・削除、利用の停止、消去および第三者提供の停止（以下「開示等」）のご請求があった場合は、本人確認のうえ、法令に従い遅滞なく対応いたします。
          </p>
          <p className="text-gray-600 text-sm">
            開示等のご請求は、第10条のお問い合わせ窓口までご連絡ください。手続きの詳細・必要書類についてご案内いたします。なお、法令に定める場合を除き、手数料は無料です。本人確認ができない場合や、法令上の例外に該当する場合は、ご請求にお応えできないことがあります。
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
          <h2 className="text-xl font-bold mb-4">第9条（プライバシーポリシーの変更）</h2>
          <p className="text-gray-600">
            当事業者は、必要に応じて本ポリシーを変更することがあります。変更後のポリシーは、本ページに掲載した時点から効力を生じるものとします。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第10条（お問い合わせ窓口・苦情の申出先）</h2>
          <p className="text-gray-600 mb-2">
            個人情報の取扱いに関するお問い合わせ、開示等のご請求、苦情の申出は、
            <Link href="/contact" className="text-primary underline">お問い合わせページ</Link>
            よりご連絡ください。
          </p>
          <ul className="text-gray-600 space-y-1 text-sm">
            <li>個人情報取扱責任者：神原良祐</li>
            <li>所在地：大阪府豊中市</li>
          </ul>
          <p className="text-gray-600 text-sm mt-2">
            なお、当事業者の対応にご納得いただけない場合は、個人情報保護委員会（<a href="https://www.ppc.go.jp/" className="text-primary underline" target="_blank" rel="noopener noreferrer">https://www.ppc.go.jp/</a>）にご相談いただくこともできます。
          </p>
        </section>

        <p className="text-gray-500 text-sm">制定日：2026年3月19日</p>
      </div>
    </div>
  );
}
