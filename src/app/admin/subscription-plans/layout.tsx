import FeatureNotOffered from '@/components/admin/FeatureNotOffered';
import { SHOW_SUBSCRIPTIONS } from '@/lib/feature-toggles';

// 月額プランは「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
// 作っても申し込み・課金・消化の手段が無いため、編集画面の代わりに案内だけを出す。データ・API は温存。
export default function SubscriptionPlansLayout({ children }: { children: React.ReactNode }) {
  if (!SHOW_SUBSCRIPTIONS) return <FeatureNotOffered title="月額プラン" />;
  return <>{children}</>;
}
