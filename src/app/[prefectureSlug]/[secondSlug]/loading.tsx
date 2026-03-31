export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-48 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-72 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-96 mb-8" />
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-4 flex gap-4">
              <div className="w-28 h-28 bg-gray-200 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-5 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
                <div className="h-4 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
