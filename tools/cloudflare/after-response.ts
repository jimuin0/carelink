import { after } from 'next/server';

// Worker-only implementation: bind Next's named export directly so the Vite
// CommonJS interop layer cannot accidentally resolve an undefined default.
export function runAfterResponse(task: () => PromiseLike<unknown>): Promise<void> {
  try {
    after(task);
    return Promise.resolve();
  } catch {
    return Promise.resolve(task()).then(() => undefined);
  }
}
