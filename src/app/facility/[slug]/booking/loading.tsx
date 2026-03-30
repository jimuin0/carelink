export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-32 mb-6" />
        <div className="bg-white rounded-2xl p-6 space-y-4">
          <div className="h-5 bg-gray-200 rounded w-40" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex justify-between items-center p-3 border border-gray-100 rounded-lg">
                <div className="space-y-1">
                  <div className="h-4 bg-gray-200 rounded w-36" />
                  <div className="h-3 bg-gray-100 rounded w-20" />
                </div>
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
