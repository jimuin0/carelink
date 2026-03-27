export default function CatalogLoading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <div className="h-4 bg-gray-200 rounded w-48 animate-pulse" />
        </div>
        <div className="px-4 sm:px-6 py-6">
          <div className="h-7 bg-gray-200 rounded w-36 mb-6 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-gray-100 animate-pulse">
                <div className="aspect-square bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="flex gap-1">
                    <div className="h-4 bg-gray-200 rounded-full w-12" />
                    <div className="h-4 bg-gray-200 rounded-full w-10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
