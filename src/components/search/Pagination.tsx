import Link from 'next/link';

interface Props {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export default function Pagination({ currentPage, totalPages, baseUrl }: Props) {
  if (totalPages <= 1) return null;

  const pages: (number | '...')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  const getUrl = (page: number) => {
    const url = new URL(baseUrl, 'http://localhost');
    url.searchParams.set('page', String(page));
    return `${url.pathname}${url.search}`;
  };

  return (
    <nav className="flex items-center justify-center gap-2 mt-8" aria-label="ページナビゲーション">
      {currentPage > 1 && (
        <Link href={getUrl(currentPage - 1)} className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50" aria-label="前のページ">
          前へ
        </Link>
      )}
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dot-${i}`} className="px-2 text-gray-400" aria-hidden="true">...</span>
        ) : (
          <Link
            key={p}
            href={getUrl(p)}
            className={`px-3 py-2 text-sm rounded-lg ${
              p === currentPage
                ? 'bg-sky-500 text-white font-bold'
                : 'border border-gray-300 hover:bg-gray-50'
            }`}
            aria-label={`${p}ページ`}
            {...(p === currentPage ? { 'aria-current': 'page' as const } : {})}
          >
            {p}
          </Link>
        )
      )}
      {currentPage < totalPages && (
        <Link href={getUrl(currentPage + 1)} className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50" aria-label="次のページ">
          次へ
        </Link>
      )}
    </nav>
  );
}
