export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-1/3" />
      <div className="h-10 bg-gray-200 rounded w-2/3" />
      <div className="h-96 bg-gray-200 rounded-xl" />
    </div>
  );
}
