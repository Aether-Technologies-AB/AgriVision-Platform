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
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const fetchData = useCallback(async () => {
    if (!url) return;
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

    setIsLoading(true);
    fetchData();

    intervalRef.current = setInterval(fetchData, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, intervalMs, enabled, url]);

  return { data, error, isStale, isLoading, lastUpdated, refresh: fetchData };
}
