import type { Facility } from '@/types';
import ViewingNow from './ViewingNow';

const VERIFIED_LABELS: Record<string, string> = {
  phone:      '電話確認済み',
  identity:   '本人確認済み',
  site_visit: '現地確認済み',
};

export default function FacilityHeader({ facility }: { facility: Facility }) {
  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="badge badge-primary">{facility.business_type}</span>
        {facility.is_verified && (
          <span
            className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full"
            title={facility.verified_type ? VERIFIED_LABELS[facility.verified_type] : '認証済み施設'}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {facility.verified_type ? VERIFIED_LABELS[facility.verified_type] : '認証済み'}
          </span>
        )}
        {facility.rating_count > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-amber-400" aria-hidden="true">★</span>
            <span className="text-sm font-bold" aria-label={`評価${Number(facility.rating_avg).toFixed(1)}点`}>{Number(facility.rating_avg).toFixed(1)}</span>
            <span className="text-xs text-gray-400">({facility.rating_count}件)</span>
          </div>
        )}
        {(facility.google_review_count ?? 0) > 0 && facility.google_rating != null && (
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2 py-0.5">
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="text-xs font-bold text-gray-700">{Number(facility.google_rating).toFixed(1)}</span>
            <span className="text-xs text-gray-400">({facility.google_review_count}件)</span>
          </div>
        )}
        {facility.view_count > 0 && (
          <span className="text-xs text-gray-400">閲覧 {facility.view_count.toLocaleString()}回</span>
        )}
        <ViewingNow viewCount={facility.view_count} />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold mb-2">{facility.name}</h1>
      {facility.catch_copy && (
        <p className="text-gray-600 text-sm bg-sky-50 rounded-lg px-3 py-2 border-l-[3px] border-sky-400">{facility.catch_copy}</p>
      )}
    </div>
  );
}
