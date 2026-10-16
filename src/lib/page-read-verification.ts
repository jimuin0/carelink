import { databaseDiagnostic } from './database-diagnostic';
import { safeCaptureException } from './safe';

/** Server page reads must not turn a failed dependency into empty or partial data.
 * Keep nullable successful data for the caller's genuine absence handling. */
export async function readPageResult<T extends { error: unknown }>(
  operation: () => PromiseLike<T>,
  context: string,
): Promise<T> {
  try {
    const result = await operation();
    if (result.error) throw result.error;
    return result;
  } catch (error) {
    safeCaptureException(databaseDiagnostic(error), context);
    throw new Error('PAGE_DATA_UNAVAILABLE');
  }
}
