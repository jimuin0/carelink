interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
}

export default function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                i + 1 <= currentStep
                  ? 'text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
              style={i + 1 <= currentStep ? { backgroundColor: 'var(--primary)' } : undefined}
            >
              {i + 1 <= currentStep - 1 ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className="text-xs mt-1 text-gray-600 hidden sm:block">{labels[i]}</span>
          </div>
          {i < totalSteps - 1 && (
            <div
              className={`w-12 sm:w-20 h-1 rounded ${
                i + 1 < currentStep ? 'bg-primary' : 'bg-gray-200'
              }`}
              style={i + 1 < currentStep ? { backgroundColor: 'var(--primary)' } : undefined}
            />
          )}
        </div>
      ))}
    </div>
  );
}
