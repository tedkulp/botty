import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Load again with the same inputs (the refresh button). */
  reload(): void;
  /** Replace the data locally, e.g. with the body a write returned. */
  setData(next: T | ((prev: T | undefined) => T)): void;
}

/** Run `load` on mount and whenever `deps` change; stale results are dropped. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    setLoading(true);
    load().then(
      (value) => {
        if (run !== latest.current) return;
        setData(value);
        setError(undefined);
        setLoading(false);
      },
      (err: unknown) => {
        if (run !== latest.current) return;
        setError(err);
        setLoading(false);
      },
    );
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}
