export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-36 mb-6" />
        <div className="bg-white rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-gray-200" />
            <div className="space-y-2 flex-1">
              <div className="h-5 bg-gray-200 rounded w-32" />
              <div className="h-4 bg-gray-100 rounded w-48" />
            </div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl h-24" />
          ))}
        </div>
      </div>
    </div>
  );
}
