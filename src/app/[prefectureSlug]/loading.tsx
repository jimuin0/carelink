export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-48 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-64 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-96 mb-8" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-4">
              <div className="h-40 bg-gray-200 rounded-xl mb-3" />
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
