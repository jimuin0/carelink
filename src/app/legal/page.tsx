import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記',
  description: 'CareLinkの特定商取引法に基づく表記。事業者名・所在地・販売価格・支払方法・返品条件等を掲載しています。',
  alternates: { canonical: '/legal' },
};

export default function LegalPage() {
  return (
    <div className="section-container">
      <div className="max-w-3xl mx-auto prose prose-gray">
        <h1 className="text-3xl font-bold mb-8">特定商取引法に基づく表記</h1>

        <table className="w-full text-sm border-collapse">
          <tbody>
            <Row label="事業者名" value="神原良祐" />
            <Row label="代表者" value="神原良祐" />
            <Row label="所在地" value="大阪府豊中市（詳細はお問い合わせください）" />
            <Row label="電話番号" value={<>請求があった場合には遅滞なく開示いたします。<Link href="/contact" className="text-primary hover:underline">お問い合わせフォーム</Link>よりご連絡ください。</>} />
            <Row label="メールアドレス" value={<>請求があった場合には遅滞なく開示いたします。<Link href="/contact" className="text-primary hover:underline">お問い合わせフォーム</Link>よりご連絡ください。</>} />
            <Row label="サービスURL" value="https://carelink-jp.com" />
            <Row label="販売価格" value="各サービス・施設ページに表示された金額（消費税込）" />
            <Row label="商品代金以外の必要料金" value="インターネット接続料金、通信料等はお客様のご負担となります。" />
            <Row
              label="支払方法"
              value="各施設の窓口にて、現金・クレジットカード等、施設が定める方法でお支払いください。当サービスは決済を代行しません。"
            />
            <Row label="支払時期" value="各施設の定める時期（来店時のお支払いが基本です）。" />
            <Row label="サービス提供時期" value="各施設の予約日時に提供いたします。" />
            <Row
              label="キャンセル・返金（返品特約）"
              value={
                <>
                  役務提供の性質上、原則としてお客様都合による返品・返金には応じられません。キャンセル・変更については各施設の定めるキャンセルポリシーに従い、所定のキャンセル料が発生する場合があります。詳細は各施設ページをご確認ください。<br />
                  当サービスは決済を扱わないため、返金処理は発生しません。キャンセル料が発生する場合は、各施設の定めるキャンセルポリシーに従い、施設に直接お支払いいただきます。
                </>
              }
            />
            <Row label="不当な勧誘について" value="当サービスは施設予約の仲介サービスです。施設での施術の勧誘は各施設の責任において行われます。トラブルがあった場合は当サービスのお問い合わせフォームよりご連絡ください。" />
            <Row label="動作環境" value="最新バージョンのChrome、Safari、Edge、Firefox" />
          </tbody>
        </table>

        <p className="text-gray-500 text-sm mt-8">制定日：2026年3月26日　最終更新日：2026年7月23日</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-b border-gray-200">
      <th className="py-3 pr-4 text-left font-bold text-gray-700 whitespace-nowrap align-top w-36">
        {label}
      </th>
      <td className="py-3 text-gray-600">{value}</td>
    </tr>
  );
}
