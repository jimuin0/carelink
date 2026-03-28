import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記',
  description: 'CareLinkの特定商取引法に基づく表記。事業者名・所在地・販売価格・支払方法・返品条件等を掲載しています。',
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
            <Row label="電話番号" value={<>お問い合わせは<Link href="/contact" className="text-primary hover:underline">お問い合わせフォーム</Link>よりお願いいたします</>} />
            <Row label="メールアドレス" value={<>お問い合わせは<Link href="/contact" className="text-primary hover:underline">お問い合わせフォーム</Link>よりお願いいたします</>} />
            <Row label="サービスURL" value="https://www.carelink-jp.com" />
            <Row label="販売価格" value="各サービスページに表示された金額（税込）" />
            <Row label="支払方法" value="クレジットカード決済" />
            <Row label="支払時期" value="予約確定時" />
            <Row label="サービス提供時期" value="各施設の予約日時に提供" />
            <Row
              label="キャンセル・返金"
              value="各施設のキャンセルポリシーに準じます。詳細は施設ページをご確認ください。"
            />
            <Row label="動作環境" value="最新バージョンのChrome、Safari、Edge、Firefox" />
          </tbody>
        </table>

        <p className="text-gray-500 text-sm mt-8">制定日：2026年3月26日</p>
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
