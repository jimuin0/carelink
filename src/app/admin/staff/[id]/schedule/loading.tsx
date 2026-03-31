export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-40 mb-6" />
      <div className="bg-white rounded-xl p-6">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-5 bg-gray-200 rounded w-8" />
              <div className="h-10 bg-gray-100 rounded flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
