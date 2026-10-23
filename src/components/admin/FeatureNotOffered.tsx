import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

/**
 * 「今は提供していない機能」の管理画面へ直接来たときに、編集画面の代わりに出す案内。
 * 出し分けの定数は src/lib/feature-toggles.ts（SHOW_JOBS / SHOW_PACKAGES / SHOW_SUBSCRIPTIONS）。
 * データは消していないので、トグルを true に戻せば元の画面がそのまま開く。
 */
export default function FeatureNotOffered({ title }: { title: string }) {
  return (
    <section>
      <SbPageHeader title={title} />
      <div className="bg-white rounded-xl p-8 text-center">
        <p className="text-sm text-gray-700">現在この機能は提供していません。</p>
        <Link href="/admin" className="mt-4 inline-block text-sm text-primary hover:underline">
          管理画面のホームへ戻る
        </Link>
      </div>
    </section>
  );
}
