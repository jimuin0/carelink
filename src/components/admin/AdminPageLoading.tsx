import PageLoading from '@/components/PageLoading';

// 全ページ共通の PageLoading へ委譲（2026年7月6日・神原さん指摘で客側ページとも統一）。
// 既存の import 元（admin配下の各ページ）を変更せずに済むよう、このファイル自体は残す。
export default function AdminPageLoading() {
  return <PageLoading />;
}
