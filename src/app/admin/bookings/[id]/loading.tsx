export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-32 mb-6" />
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="h-5 bg-gray-200 rounded w-48 mb-2" />
        <div className="grid sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-gray-100 rounded w-20" />
              <div className="h-5 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
