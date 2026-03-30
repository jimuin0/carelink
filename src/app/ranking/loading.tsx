export default function Loading() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-72 mb-6" />
        <div className="flex flex-wrap gap-2 mb-8">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-16 bg-gray-200 rounded-full" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
              <div className="flex-1 bg-white rounded-2xl h-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
