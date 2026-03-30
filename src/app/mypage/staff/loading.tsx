export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-36 mb-6" />
      <div className="grid sm:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-100 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
