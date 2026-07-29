import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '利用規約',
  description: 'CareLinkのサービス利用規約。サービス概要・利用条件・禁止事項・免責事項等について定めています。',
  alternates: { canonical: '/terms' },
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
            本サービスは、医療・福祉・美容分野の施設を探すユーザーと施設をつなぐプラットフォームです。施設情報の検索・予約・口コミ等の機能を、ユーザーおよび施設の双方に提供します。
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
            <li>
              当事業者は、掲載施設が営業に必要な許可・免許・登録・届出（開設届等）を完了しているか否か、
              および施術者が必要な資格を有しているか否かについて、確認・審査を行っておらず、これらに関して一切の保証をしません。
              施設のご利用にあたっては、利用者ご自身で必要な確認を行ってください。
            </li>
            <li>システム障害、天災、その他不可抗力によるサービスの中断について、当事業者は責任を負いません。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第6条（個人情報の取扱い）</h2>
          <p className="text-gray-600">
            利用者の個人情報の取扱いについては、別途定める
            <Link href="/privacy" className="text-primary underline">プライバシーポリシー</Link>
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

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第10条（施設掲載サービス）</h2>
          <p className="text-gray-600 mb-3">
            施設掲載者（以下「掲載者」）は、本サービスを通じて自らが運営する施設の情報を掲載し、予約管理機能を利用することができます。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2 text-sm">
            <li>掲載料・予約手数料は無料です。将来有料プランを設定する場合は事前に通知します。</li>
            <li>掲載者は自ら登録した情報の正確性について責任を負うものとします。</li>
            <li>掲載者はいつでも施設情報の公開・非公開を切り替えることができます。</li>
            <li>当事業者は、法令違反・公序良俗違反等の掲載を事前の通知なく非公開にできるものとします。</li>
            <li>掲載者が本サービスを退会した場合、当該施設の情報は速やかに削除されます。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第11条（データの取扱い）</h2>
          <p className="text-gray-600 mb-3">
            掲載者が本サービスに登録した施設情報・予約データ・顧客データは、掲載者に帰属します。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2 text-sm">
            <li>当事業者はサービス運営・改善の目的でのみデータを利用します。</li>
            <li>掲載者は退会時にデータのエクスポートを請求できます。</li>
            <li>当事業者は、統計的に処理された匿名データを事業改善に利用できるものとします。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">第12条（掲載者の表明保証）</h2>
          <p className="text-gray-600 mb-3">
            掲載者は、本サービスに施設情報を掲載するにあたり、掲載開始時および掲載期間中を通じて、以下の事項を表明し、保証するものとします。
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2 text-sm">
            <li>
              掲載する施設の運営に関し、法令上必要となるすべての許可・免許・登録・届出を、所轄官庁に対して適法に完了していること。
              これには、美容師法・理容師法に基づく開設届、あん摩マツサージ指圧師、はり師、きゆう師等に関する法律および柔道整復師法に基づく施術所開設届、
              医療法に基づく診療所開設届等が含まれますが、これらに限られません。
            </li>
            <li>提供する施術・サービスについて、法令上必要な国家資格等を有する者が当該施術・サービスを提供すること。</li>
            <li>
              掲載内容が、医療法および医療広告ガイドライン、あん摩マツサージ指圧師、はり師、きゆう師等に関する法律、
              景品表示法その他の関連法令に違反しないこと。
            </li>
          </ul>
          <p className="text-gray-600 mt-4 mb-3 text-sm">
            2. 当事業者は、前項の表明保証の内容について確認・調査する義務を負わず、また実際に確認・調査を行っていません。
            前項に違反する掲載により利用者その他の第三者に損害が生じた場合、当該損害についてはすべて掲載者が責任を負うものとし、
            当事業者は責任を負いません。
          </p>
          <p className="text-gray-600 text-sm">
            3. 当事業者は、掲載者が第1項に違反していることが判明した場合、事前の通知なく当該施設情報を非公開とし、
            または掲載者の登録を抹消することができるものとします。
          </p>
        </section>

        <p className="text-gray-500 text-sm">制定日：2026年3月19日 ／ 改定日：2026年7月29日</p>
      </div>
    </div>
  );
}
