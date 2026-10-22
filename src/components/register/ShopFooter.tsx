import Link from 'next/link';

/**
 * 店舗向けページ（/register・/register/complete）のフッター。
 *
 * 来院者向けのフッター（Footer.tsx）は濃い地色にエリア×業種の大量のリンクを並べており、
 * くすみ系の店舗向けページの最後に置くと別のサイトへ飛んだように見えた。店舗が登録前に
 * 確認したい表記と問い合わせ先だけを、同じテーマの色で置く。
 * 色はテーマ変数（globals.css の .theme-ecru）だけを参照する。
 */
const LINKS: { href: string; label: string }[] = [
  { href: '/legal', label: '特定商取引法に基づく表記' },
  { href: '/terms', label: '利用規約' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/contact', label: 'お問い合わせ' },
];

export default function ShopFooter() {
  return (
    <footer className="theme-ecru border-t border-(--ecru-line) bg-(--ecru-surface) text-(--ecru-muted)">
      <div className="mx-auto max-w-5xl px-7 py-10 sm:px-12">
        <nav aria-label="店舗向けフッター">
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-block py-1 text-(--ecru-text) underline-offset-4 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mt-6 text-sm">運営：神原良祐（HALグループ）</p>
        <p className="mt-2 text-xs">&copy; {new Date().getFullYear()} CareLink</p>
      </div>
    </footer>
  );
}
