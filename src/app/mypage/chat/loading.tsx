export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-32 mb-6" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-100 rounded w-2/3" />
            </div>
            <div className="h-3 bg-gray-100 rounded w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
