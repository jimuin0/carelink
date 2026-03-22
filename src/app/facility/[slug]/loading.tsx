export default function FacilityLoading() {
  return (
    <div className="bg-gray-50 min-h-screen animate-pulse">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        {/* Breadcrumb skeleton */}
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-12 bg-gray-200 rounded" />
            <div className="h-3 w-3 bg-gray-200 rounded" />
            <div className="h-3 w-24 bg-gray-200 rounded" />
            <div className="h-3 w-3 bg-gray-200 rounded" />
            <div className="h-3 w-32 bg-gray-200 rounded" />
          </div>
        </div>

        {/* Photo skeleton */}
        <div className="aspect-[16/9] bg-gray-200" />

        {/* Header skeleton */}
        <div className="px-4 sm:px-6 py-5">
          <div className="flex gap-2 mb-3">
            <div className="h-6 w-28 bg-gray-200 rounded-full" />
            <div className="h-6 w-20 bg-gray-200 rounded-full" />
          </div>
          <div className="h-7 w-64 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-48 bg-gray-200 rounded" />
        </div>

        {/* Tab skeleton */}
        <div className="flex border-b border-gray-200 px-4 sm:px-6 gap-1">
          <div className="h-11 w-16 bg-gray-200 rounded" />
          <div className="h-11 w-20 bg-gray-200 rounded" />
          <div className="h-11 w-24 bg-gray-200 rounded" />
          <div className="h-11 w-20 bg-gray-200 rounded" />
        </div>

        {/* Content skeleton */}
        <div className="px-4 sm:px-6 py-6 space-y-6">
          {/* Section title */}
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-gray-200 rounded-full" />
            <div className="h-5 w-32 bg-gray-200 rounded" />
          </div>
          {/* Paragraphs */}
          <div className="space-y-2">
            <div className="h-4 w-full bg-gray-200 rounded" />
            <div className="h-4 w-5/6 bg-gray-200 rounded" />
            <div className="h-4 w-4/6 bg-gray-200 rounded" />
          </div>
          {/* Section title */}
          <div className="flex items-center gap-2 mt-4">
            <div className="w-1 h-5 bg-gray-200 rounded-full" />
            <div className="h-5 w-40 bg-gray-200 rounded" />
          </div>
          {/* Menu cards */}
          <div className="space-y-3">
            <div className="h-20 bg-gray-100 rounded-xl" />
            <div className="h-20 bg-gray-100 rounded-xl" />
            <div className="h-20 bg-gray-100 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
