/**
 * 写真が無いスタッフの代わりに出す頭文字（2026年10月23日）。
 *
 * 以前は人型のアイコンを薄い水色で出していたため、写真の無いスタッフが全員同じ顔に見え、
 * 「写真が読み込めていない」ようにも見えた。名前の最初の 1 文字を落ち着いた地色の上に出す。
 * 名前は隣に文字で出ているので、この頭文字は読み上げない（aria-hidden）。
 * 色は gray-600 の文字に gray-100 の地（7.1:1・2026年10月23日 計算）。
 */
export function staffInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '';
}

export default function StaffMonogram({ name, className = 'text-4xl' }: { name: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="staff-monogram"
      className={`flex h-full w-full items-center justify-center bg-gray-100 font-bold text-gray-600 select-none ${className}`}
    >
      {staffInitial(name)}
    </div>
  );
}
