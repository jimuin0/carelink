export default function ReviewsLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-1/4" />
      <div className="flex gap-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-9 w-20 bg-gray-200 rounded-full" />)}
      </div>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-5 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/4" />
        </div>
      ))}
    </div>
  );
}
