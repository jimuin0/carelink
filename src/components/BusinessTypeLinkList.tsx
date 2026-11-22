// 業種リンク一覧（ヘッダーのメニュー・フッターで共用）。美容系を先に並べ、医療機関は
// 「病院・クリニック」の折りたたみ（<details>）にまとめる。閉じていてもリンクは HTML に残るので
// 検索エンジンは全業種のページを辿れる。並びと分け方は src/lib/constants.ts。
import Link from '@/components/BrowseLink';
import { businessTypeLabel } from '@/lib/business-type-label';
import { groupedMedicalBusinessTypes, MEDICAL_GROUP_LABEL, primaryBusinessTypes } from '@/lib/constants';

const hrefFor = (type: string) => `/search?type=${encodeURIComponent(type)}`;

export default function BusinessTypeLinkList({
  linkClassName,
  summaryClassName,
  onNavigate,
}: {
  linkClassName: string;
  summaryClassName?: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {primaryBusinessTypes.map((type) => (
        <Link key={type} href={hrefFor(type)} className={linkClassName} onClick={onNavigate}>
          {businessTypeLabel(type)}
        </Link>
      ))}
      <details data-medical-group="" className="group">
        <summary className={`${summaryClassName ?? linkClassName} cursor-pointer list-none flex items-center justify-between [&::-webkit-details-marker]:hidden`}>
          {MEDICAL_GROUP_LABEL}
          <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="pl-3 flex flex-col">
          {groupedMedicalBusinessTypes.map((type) => (
            <Link key={type} href={hrefFor(type)} className={linkClassName} onClick={onNavigate}>
              {businessTypeLabel(type)}
            </Link>
          ))}
        </div>
      </details>
      <Link href={hrefFor('その他')} className={linkClassName} onClick={onNavigate}>
        {businessTypeLabel('その他')}
      </Link>
    </>
  );
}
