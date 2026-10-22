import FeatureNotOffered from '@/components/admin/FeatureNotOffered';
import { SHOW_JOBS } from '@/lib/feature-toggles';

// 求人は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
// 公開側の求人導線が止まっている間は、作った求人を誰も見られない。応募一覧（/admin/jobs/applications）
// も含め、編集画面の代わりに案内だけを出す。データ・API は温存。
export default function JobsLayout({ children }: { children: React.ReactNode }) {
  if (!SHOW_JOBS) return <FeatureNotOffered title="求人" />;
  return <>{children}</>;
}
