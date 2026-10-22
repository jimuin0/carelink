'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * マイページのお気に入りで、いま表示できない施設（掲載が下書き・停止に戻った施設）を外すボタン。
 * 施設ページは公開中しか開けずハートも押せないため、以前はこのお気に入りを外す手段が無かった。
 * 外す操作は /api/favorites（isFavorited:false）で、施設の掲載状態に関係なく受け付ける
 * （toggle_user_favorite_atomic・20261023140000）。成功したら一覧を読み直す。
 */
export default function RemoveFavoriteButton({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [removed, setRemoved] = useState(false);

  const handleRemove = async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, isFavorited: false }),
        signal: AbortSignal.timeout(10000),
      });
      const body = res.ok ? await res.json().catch(() => null) : null;
      // 応答が「外れた」ことを確かめられたときだけ成功とする（確かめられない結果を成功と見せない）。
      if (body?.isFavorited !== false) throw new Error('Unconfirmed favorite removal');
      setRemoved(true);
      router.refresh();
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  if (removed) {
    return <p role="status" className="mt-4 text-sm text-gray-700">お気に入りから外しました。</p>;
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="w-full rounded-xl border border-gray-300 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? '処理中...' : 'お気に入りから外す'}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          お気に入りから外せませんでした。時間をおいて再度お試しください。
        </p>
      )}
    </div>
  );
}
