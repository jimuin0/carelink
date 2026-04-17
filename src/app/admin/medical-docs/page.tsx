'use client';

import Link from 'next/link';

const TEMPLATES = [
  {
    href: '/admin/medical-docs/insurance',
    icon: '📋',
    title: '保険請求書',
    desc: '療養費支給申請書（鍼灸・マッサージ）の入力・印刷',
    color: 'border-blue-100 hover:border-blue-300',
    badge: '鍼灸/マッサージ',
  },
  {
    href: '/admin/medical-docs/referral',
    icon: '📝',
    title: '紹介状',
    desc: '医療機関への患者紹介状・診療情報提供書の作成・印刷',
    color: 'border-green-100 hover:border-green-300',
    badge: '診療情報提供',
  },
];

export default function MedicalDocsPage() {
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">医療書類テンプレート</h1>
        <p className="text-xs text-gray-400 mt-0.5">保険請求・紹介状など各種書類を作成して印刷できます</p>
      </div>

      <div className="grid gap-4">
        {TEMPLATES.map((t) => (
          <Link key={t.href} href={t.href}
            className={`bg-white rounded-xl border-2 ${t.color} p-5 flex items-start gap-4 transition-colors group`}>
            <div className="text-4xl">{t.icon}</div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-gray-800 group-hover:text-sky-600 transition-colors">{t.title}</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.badge}</span>
              </div>
              <p className="text-sm text-gray-500">{t.desc}</p>
            </div>
            <svg className="w-5 h-5 text-gray-400 group-hover:text-sky-500 ml-auto shrink-0 mt-0.5 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>

      <div className="bg-amber-50 rounded-xl p-4 text-xs text-amber-700">
        <strong>注意:</strong> 本テンプレートは記入補助ツールです。提出前に必ず内容を確認し、医師の同意書など必要書類と合わせて申請してください。
      </div>
    </div>
  );
}
