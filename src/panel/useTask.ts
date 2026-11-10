import { useCallback, useRef, useState } from "preact/hooks";

/** Wraps an async operation with busy + error state. run() never throws; it resolves undefined on failure. */
export function useTask<Args extends unknown[], T>(task: (...args: Args) => Promise<T>) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const latestTask = useRef(task);
  latestTask.current = task;

  const run = useCallback(async (...args: Args): Promise<T | undefined> => {
    setIsBusy(true);
    setError("");
    try {
      return await latestTask.current(...args);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    } finally {
      setIsBusy(false);
    }
  }, []);
  const reset = useCallback(() => {
    setIsBusy(false);
    setError("");
  }, []);
  return { run, reset, isBusy, error };
}
