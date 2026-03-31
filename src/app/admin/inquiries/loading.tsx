export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-36 mb-6" />
      <div className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <div className="h-5 bg-gray-200 rounded w-1/3" />
              <div className="h-5 bg-gray-100 rounded-full w-16" />
            </div>
            <div className="h-4 bg-gray-100 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
