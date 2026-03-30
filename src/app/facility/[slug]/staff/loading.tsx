export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm animate-pulse">
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <div className="h-3 bg-gray-100 rounded w-48" />
        </div>
        <div className="px-4 sm:px-6 py-6">
          <div className="h-6 bg-gray-200 rounded w-32 mb-6" />
          <div className="grid sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl">
                <div className="w-16 h-16 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-gray-200 rounded w-24" />
                  <div className="h-4 bg-gray-100 rounded w-16" />
                  <div className="flex gap-1">
                    {[0, 1].map((j) => (
                      <div key={j} className="h-5 w-12 bg-gray-100 rounded-full" />
                    ))}
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
