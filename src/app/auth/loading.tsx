export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md mx-auto p-6 animate-pulse">
        <div className="h-10 w-32 bg-gray-200 rounded mx-auto mb-8" />
        <div className="bg-white rounded-2xl shadow-sm p-8 space-y-4">
          <div className="h-5 w-24 bg-gray-200 rounded" />
          <div className="h-12 bg-gray-200 rounded-lg" />
          <div className="h-5 w-24 bg-gray-200 rounded" />
          <div className="h-12 bg-gray-200 rounded-lg" />
          <div className="h-12 bg-gray-200 rounded-lg mt-4" />
        </div>
      </div>
    </div>
  );
}
