import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          ページが見つかりません
        </h2>
        <p className="text-gray-600 mb-8">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary">
            トップページへ戻る
          </Link>
          <Link href="/salon" className="btn-outline">
            集客したい方
          </Link>
          <a href={`${process.env.NEXT_PUBLIC_RECRUIT_URL || 'https://carelink-recruit.vercel.app'}/recruit`} className="btn-outline">
            採用したい方
          </a>
          <a href={`${process.env.NEXT_PUBLIC_RECRUIT_URL || 'https://carelink-recruit.vercel.app'}/jobs`} className="btn-outline">
            求職者の方
          </a>
        </div>
      </div>
    </div>
  );
}
