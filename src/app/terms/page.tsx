import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '利用規約',
  description: 'CareLinkのサービス利用規約。サービス概要・利用条件・禁止事項・免責事項等について定めています。',
};

export default function TermsPage() {
  return (
    <div className="section-container">
      <div className="max-w-3xl mx-auto prose prose-gray">
        <h1 className="text-3xl font-bold mb-8">利用規約</h1>

        <p className="text-gray-600 mb-8">
          本利用規約（以下「本規約」）は、神原良祐（以下「当事業者」）が提供するCareLink（以下「本サービス」）の利用に関する条件を定めるものです。本サービスをご利用いただくすべての方（以下「利用者」）は、本規約に同意したものとみなします。
        </p>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第1条（サービス概要）</h2>
          <p className="text-gray-600">
            本サービスは、医療・福祉・美容業界に特化した集客プラットフォームです。施設・サロンの集客支援を目的として、施設情報の掲載、検索、予約等の機能を提供します。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第2条（利用条件）</h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>本サービスの利用にあたり、正確かつ最新の情報を登録してください。</li>
            <li>利用者は、自己の責任において本サービスを利用するものとします。</li>
            <li>未成年者が利用する場合は、法定代理人の同意を得てください。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第3条（禁止事項）</h2>
          <p className="text-gray-600 mb-2">利用者は、以下の行為を行ってはなりません。</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>虚偽の情報を登録する行為</li>
            <li>他の利用者または第三者の権利を侵害する行為</li>
            <li>法令または公序良俗に反する行為</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>不正アクセスまたはそのおそれのある行為</li>
            <li>本サービスを利用した営業活動、宗教活動、政治活動等</li>
            <li>その他、当事業者が不適切と判断する行為</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第4条（サービスの変更・停止）</h2>
          <p className="text-gray-600">
            当事業者は、利用者への事前通知なく、本サービスの内容を変更、または提供を一時停止・終了することができるものとします。これにより利用者に生じた損害について、当事業者は一切の責任を負いません。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第5条（免責事項）</h2>
          <ul className="list-disc pl-6 text-gray-600 space-y-1">
            <li>当事業者は、本サービスにおける情報の正確性、完全性、有用性等について保証しません。</li>
            <li>本サービスを通じて行われた施設と利用者間の取引等について、当事業者は一切の責任を負いません。</li>
            <li>システム障害、天災、その他不可抗力によるサービスの中断について、当事業者は責任を負いません。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第6条（個人情報の取扱い）</h2>
          <p className="text-gray-600">
            利用者の個人情報の取扱いについては、別途定める
            <Link href="/privacy" className="text-primary hover:underline">プライバシーポリシー</Link>
            に従います。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第7条（知的財産権）</h2>
          <p className="text-gray-600">
            本サービスに関するすべてのコンテンツ（テキスト、画像、デザイン、プログラム等）の知的財産権は、当事業者または正当な権利者に帰属します。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第8条（規約の変更）</h2>
          <p className="text-gray-600">
            当事業者は、必要に応じて本規約を変更することがあります。変更後の規約は、本ページに掲載した時点から効力を生じるものとします。
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第9条（準拠法・管轄裁判所）</h2>
          <p className="text-gray-600">
            本規約の解釈および適用は日本法に準拠するものとし、本サービスに関する紛争については、大阪地方裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>

        <p className="text-gray-500 text-sm">制定日：2026年3月19日</p>
      </div>
    </div>
  );
}
