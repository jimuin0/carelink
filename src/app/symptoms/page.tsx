import type { Metadata } from 'next';
import Link from 'next/link';
import { isAiEnabled } from '@/lib/integration-availability';
import SymptomCheckerClient from './SymptomCheckerClient';

export const metadata: Metadata = {
  title: 'AI症状チェッカー',
  alternates: { canonical: '/symptoms' },
};

/**
 * AI 症状チェッカーの入口（サーバコンポーネントの門番）。
 *
 * 【2026年7月30日 是正】
 * 本番の ANTHROPIC_API_KEY が未設定のまま、このページがトップページからリンクされていた。
 * 客が症状を入力して送信すると POST /api/symptoms/suggest が 500（AI処理に失敗しました）を返し、
 * 「AIが提案します」と誘っておいてエラーだけを返す状態だった（実測で確認）。
 *
 * 表示を設定に従属させる（判定理由は lib/integration-availability.ts）。
 * 鍵が入っていない間は入力欄を出さず、代わりに使える導線（症状別ページ・検索）へ案内する。
 * 神原さんが鍵を入れた瞬間にチェッカーが自動で復活し、コード変更は要らない。
 */
export default function SymptomsPage() {
  if (!isAiEnabled()) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-3">AI症状チェッカーは準備中です</h1>
        <p className="text-gray-600 mb-8">
          ただいま準備を進めています。お急ぎの場合は、症状別のページや検索からお探しください。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/symptom/stiff-shoulder" className="btn-primary">症状から探す</Link>
          <Link href="/search" className="btn-outline">サロン・クリニックを検索</Link>
        </div>
      </div>
    );
  }
  return <SymptomCheckerClient />;
}
