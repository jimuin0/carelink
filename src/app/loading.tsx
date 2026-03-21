export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="animate-pulse">
        {/* Hero skeleton */}
        <div className="text-center mb-16">
          <div className="h-4 bg-gray-200 rounded-full w-32 mx-auto mb-6" />
          <div className="h-10 bg-gray-200 rounded-lg w-3/4 mx-auto mb-4" />
          <div className="h-10 bg-gray-200 rounded-lg w-1/2 mx-auto mb-6" />
          <div className="h-5 bg-gray-200 rounded w-2/3 mx-auto mb-10" />
          <div className="flex gap-4 justify-center">
            <div className="h-14 bg-gray-200 rounded-lg w-48" />
            <div className="h-14 bg-gray-200 rounded-lg w-48" />
          </div>
        </div>
        {/* Cards skeleton */}
        <div className="grid sm:grid-cols-3 gap-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-lg p-8">
              <div className="h-10 w-10 bg-gray-200 rounded-full mx-auto mb-4" />
              <div className="h-6 bg-gray-200 rounded w-3/4 mx-auto mb-3" />
              <div className="h-4 bg-gray-200 rounded w-full mb-2" />
              <div className="h-4 bg-gray-200 rounded w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
