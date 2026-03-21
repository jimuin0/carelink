export default function FacilityLoading() {
  return (
    <div className="bg-gray-50 min-h-screen animate-pulse">
      {/* Photo skeleton */}
      <div className="aspect-[16/9] bg-gray-200 max-w-4xl mx-auto" />

      <div className="max-w-4xl mx-auto bg-white">
        {/* Header skeleton */}
        <div className="px-4 sm:px-6 py-5">
          <div className="flex gap-2 mb-3">
            <div className="h-6 w-20 bg-gray-200 rounded-full" />
            <div className="h-6 w-16 bg-gray-200 rounded-full" />
          </div>
          <div className="h-7 w-64 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-48 bg-gray-200 rounded" />
        </div>

        {/* Tab skeleton */}
        <div className="flex border-b border-gray-200 px-4 sm:px-6 gap-4">
          <div className="h-10 w-16 bg-gray-200 rounded" />
          <div className="h-10 w-16 bg-gray-200 rounded" />
          <div className="h-10 w-20 bg-gray-200 rounded" />
        </div>

        {/* Content skeleton */}
        <div className="px-4 sm:px-6 py-6 space-y-4">
          <div className="h-4 w-full bg-gray-200 rounded" />
          <div className="h-4 w-3/4 bg-gray-200 rounded" />
          <div className="h-4 w-5/6 bg-gray-200 rounded" />
          <div className="h-4 w-2/3 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}
