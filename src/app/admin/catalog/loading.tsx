export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-36" />
        <div className="h-9 bg-gray-200 rounded w-28" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-white rounded-xl overflow-hidden">
            <div className="aspect-square bg-gray-200" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
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
  );
}
