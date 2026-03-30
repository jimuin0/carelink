export default function AdminLoading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-40 mb-6" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 space-y-2">
            <div className="h-4 bg-gray-100 rounded w-20" />
            <div className="h-6 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl p-6">
        <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
