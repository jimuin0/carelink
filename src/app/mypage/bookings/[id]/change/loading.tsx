export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-32 mb-6" />
      <div className="bg-white rounded-2xl p-6 space-y-4">
        <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-3 border border-gray-100 rounded-lg space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
        <div className="h-10 bg-gray-200 rounded w-full mt-4" />
      </div>
    </div>
  );
}
