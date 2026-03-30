export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-28" />
        <div className="h-9 bg-gray-200 rounded w-28" />
      </div>
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 flex gap-4">
            <div className="w-24 h-24 bg-gray-200 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
