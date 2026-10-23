import FeatureNotOffered from '@/components/admin/FeatureNotOffered';
import { SHOW_PACKAGES } from '@/lib/feature-toggles';

// 回数券は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
// 作っても販売・消化の手段が無いため、編集画面の代わりに案内だけを出す。データ・API は温存。
export default function PackagesLayout({ children }: { children: React.ReactNode }) {
  if (!SHOW_PACKAGES) return <FeatureNotOffered title="回数券" />;
  return <>{children}</>;
}
