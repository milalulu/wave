/** Bound waiting even when a provider cannot cancel its underlying transport. */
export function withDeadline<T>(operation: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      action();
    };
    const abort = () => finish(() => reject(new Error("Request cancelled")));
    const timer = setTimeout(() => finish(() => reject(new Error("Provider timed out"))), ms);
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
