'use client';

import { useState, useEffect } from 'react';
import type { AvailabilityStatus } from '@/app/api/availability/route';

/**
 * 施設ページの「本日の空き状況」バッジ。
 *
 * 【2026年7月30日 是正・本番実測で発覚した2つの虚偽表示】
 * 旧実装は /api/availability の `slots` をそのまま「本日残り{n}枠」と表示していた。
 * しかし `slots` は status 判定用に 3 で丸めた内部値で、客に見せる残り枠数ではない。
 *   - ハル 豊中本店／イマイビル店：実際 45 枠空いていたのに「本日残り3枠」を赤字点滅で表示
 *     → 実態より品薄に見せる誤った希少性の演出（景表法の有利誤認に触れうる）
 *   - 訪問専門 神原鍼灸院（木曜が定休）：0 枠が一律 full 扱いだったため「本日満枠」と表示
 *     → 休んでいる日を「人気で埋まっている」と誤認させる
 *
 * 【恒久的な直し方】
 * 丸めた数値を客に見せない。API が返す status（available / few / full / closed / past）だけを
 * 根拠に文言を決める。数値を出さなければ、丸め方が変わっても嘘にならない。
 * 具体的な残り枠数を出したい場合は、丸めていない実数を返す API を用意してから行うこと。
 */
export default function RemainingSlots({ facilityId }: { facilityId: string }) {
  const [status, setStatus] = useState<AvailabilityStatus | null>(null);

  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    fetch(`/api/availability?facilityId=${facilityId}&year=${year}&month=${month}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        const todayStatus = data?.dates?.[today]?.status;
        if (todayStatus) setStatus(todayStatus as AvailabilityStatus);
      })
      .catch(() => {});
  }, [facilityId]);

  // 空きが十分ある日・過去日・取得失敗は何も出さない（煽らない）。
  if (status === null || status === 'available' || status === 'past') return null;

  // 定休日は「満席」ではない。人気を演出せず、事実だけを落ち着いた色で伝える。
  if (status === 'closed') {
    return <span className="text-xs text-gray-500 font-medium">本日休業</span>;
  }

  // 残りわずか。具体的な枠数は出さない（丸めた内部値しか持っていないため）。
  if (status === 'few') {
    return <span className="text-xs text-orange-600 font-bold">本日残りわずか</span>;
  }

  // 営業日で空きゼロ。「満枠」より「空きなし」の方が、予約導線の事実として正確。
  return (
    <span className="text-xs text-gray-600 font-medium">
      本日空きなし
      {/* 監査F13: キャンセル待ち登録は未実装（登録UIがフロントに存在しない）。
          今回は実装せず「近日公開」表示のみに留める（2026年7月5日・神原さん決定）。 */}
      <span className="ml-1 text-gray-400 font-normal">（キャンセル待ち登録：近日公開）</span>
    </span>
  );
}
