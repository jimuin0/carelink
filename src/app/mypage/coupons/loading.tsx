export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-28 mb-6" />
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="h-5 bg-gray-200 rounded w-2/3" />
              <div className="h-6 w-14 bg-gray-100 rounded-full" />
            </div>
            <div className="h-4 bg-gray-100 rounded w-1/2 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
