export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-36" />
        <div className="flex gap-2">
          <div className="h-9 bg-gray-200 rounded w-20" />
          <div className="h-9 bg-gray-200 rounded w-20" />
        </div>
      </div>
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
    </div>
  );
}
