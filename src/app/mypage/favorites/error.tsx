'use client';

import LoadError from '@/components/admin/LoadError';

export default function FavoritesError() {
  // Retry the current GET document without replaying a save or clearing state.
  return <LoadError message="お気に入りを取得できませんでした" onRetry={() => window.location.reload()} />;
}
