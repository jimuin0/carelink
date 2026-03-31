export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-36 mb-6" />
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 flex justify-between items-center">
            <div className="space-y-2">
              <div className="h-5 bg-gray-200 rounded w-40" />
              <div className="h-4 bg-gray-100 rounded w-56" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded w-14" />
              <div className="h-8 bg-gray-100 rounded w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
