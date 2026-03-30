export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-32 mb-6" />
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex gap-4">
            <div className="w-20 h-20 bg-gray-200 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-2/3" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((j) => (
                  <div key={j} className="w-4 h-4 bg-gray-100 rounded" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
