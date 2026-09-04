"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface UsePollingOptions<T> {
  url: string | null;
  intervalMs: number;
  enabled?: boolean;
  onData?: (data: T) => void;
}

interface UsePollingResult<T> {
  data: T | null;
  error: string | null;
  isStale: boolean;
  isLoading: boolean;
  lastUpdated: Date | null;
  refresh: () => void;
}

export function usePolling<T>({
  url,
  intervalMs,
  enabled = true,
  onData,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchRef = useRef(0);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const fetchData = useCallback(async () => {
    if (!url) return;
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setIsStale(false);
      setLastUpdated(new Date());
      onDataRef.current?.(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
      setIsStale(true);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!enabled || !url) {
      setIsLoading(false);
      return;
    }

    // The repeating poll only runs while the tab is visible. Every one of these
    // requests hits Neon, and Neon only auto-suspends the compute after ~5 min
    // idle — so a dashboard tab left open in the background used to hold the
    // compute active around the clock and burn CU-hours for nobody. The initial
    // fetch below is unconditional (a tab opened in the background still has
    // data ready when you switch to it); it's the *interval* that's gated.
    const start = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(fetchData, intervalMs);
    };
    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Catch up on whatever the pause missed, then resume the cadence.
        if (Date.now() - lastFetchRef.current >= intervalMs) fetchData();
        start();
      } else {
        stop();
      }
    };

    setIsLoading(true);
    fetchData();
    if (document.visibilityState === "visible") start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchData, intervalMs, enabled, url]);

  return { data, error, isStale, isLoading, lastUpdated, refresh: fetchData };
}
