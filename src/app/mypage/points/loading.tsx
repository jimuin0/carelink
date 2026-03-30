export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-28 mb-6" />
      <div className="bg-white rounded-2xl p-6 mb-6">
        <div className="h-4 bg-gray-100 rounded w-24 mb-2" />
        <div className="h-8 bg-gray-200 rounded w-32" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 flex justify-between items-center">
            <div className="space-y-1">
              <div className="h-4 bg-gray-200 rounded w-40" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
            <div className="h-5 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
