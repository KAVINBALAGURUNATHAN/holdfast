import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** HTTP status of the last failed load (0 = network error), or null. */
  errorStatus: number | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

/** Runs `fn` on mount and whenever `deps` change; exposes reload + optimistic setData. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const callId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const result = await fnRef.current();
      if (id === callId.current) setDataState(result);
    } catch (e) {
      if (id === callId.current) {
        setError(e instanceof Error ? e.message : String(e));
        setErrorStatus(e instanceof ApiError ? e.status : null);
      }
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | ((prev: T | null) => T)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | null) => T)(prev) : updater));
  }, []);

  return { data, error, errorStatus, loading, reload, setData };
}

const REVIEWER_KEY = "holdfast.reviewer";

/** Name of the human approver, persisted per browser (used as `decided_by`). */
export function useReviewerName(): [string, (v: string) => void] {
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem(REVIEWER_KEY) || "Demo Reviewer";
    } catch {
      return "Demo Reviewer";
    }
  });
  const update = useCallback((v: string) => {
    setName(v);
    try {
      localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);
  return [name, update];
}
