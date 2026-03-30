export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm animate-pulse">
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <div className="h-3 bg-gray-100 rounded w-48" />
        </div>
        <div className="px-4 sm:px-6 py-6">
          <div className="h-6 bg-gray-200 rounded w-24 mb-6" />
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex border border-gray-100 rounded-xl overflow-hidden">
                <div className="w-28 h-28 sm:w-36 sm:h-36 bg-gray-200 shrink-0" />
                <div className="p-4 flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-100 rounded w-24 mt-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
