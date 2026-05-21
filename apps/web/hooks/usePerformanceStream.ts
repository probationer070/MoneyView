"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPerformanceStreamUrl, type PerformanceEvent } from "@/lib/devMonitor";

type ConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "paused"
  | "error";

interface UsePerformanceStreamOptions {
  enabled?: boolean;
  seedEvents?: PerformanceEvent[];
  maxBuffer?: number;
}

function mergeEvents(current: PerformanceEvent[], incoming: PerformanceEvent[], maxBuffer: number) {
  const merged = new Map<string, PerformanceEvent>();
  for (const event of current) {
    merged.set(event.id, event);
  }
  for (const event of incoming) {
    merged.set(event.id, event);
  }
  return Array.from(merged.values())
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .slice(-maxBuffer);
}

export function usePerformanceStream({
  enabled = true,
  seedEvents = [],
  maxBuffer = 1000,
}: UsePerformanceStreamOptions = {}) {
  const [streamEvents, setStreamEvents] = useState<PerformanceEvent[]>(() => seedEvents.slice(-maxBuffer));
  const [streamState, setStreamState] = useState<Exclude<ConnectionState, "idle" | "paused">>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [clearCutoff, setClearCutoff] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const openStreamRef = useRef<() => void>(() => {});

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const openStream = useCallback(() => {
    if (!enabled || isPaused || eventSourceRef.current) {
      return;
    }

    const eventSource = new EventSource(buildPerformanceStreamUrl().toString());
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      reconnectAttemptRef.current = 0;
      setStreamState("live");
      setErrorMessage(null);
    };

    eventSource.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as PerformanceEvent;
        setStreamEvents((current) => mergeEvents(current, [event], maxBuffer));
      } catch {
        setErrorMessage("Received a malformed monitor event.");
        setStreamState("error");
      }
    };

    eventSource.onerror = () => {
      closeStream();
      if (!enabled || isPaused) {
        return;
      }
      reconnectAttemptRef.current += 1;
      setStreamState("reconnecting");
      setErrorMessage("Live event stream disconnected. Reconnecting.");
      const retryDelay = Math.min(5000, 500 * 2 ** Math.min(reconnectAttemptRef.current, 4));
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        openStreamRef.current();
      }, retryDelay);
    };
  }, [clearReconnectTimer, closeStream, enabled, isPaused, maxBuffer]);

  useEffect(() => {
    openStreamRef.current = openStream;
  }, [openStream]);

  const events = useMemo(() => {
    const cutoff = clearCutoff;
    const filteredSeedEvents = cutoff == null
      ? seedEvents
      : seedEvents.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
    const filteredStreamEvents = cutoff == null
      ? streamEvents
      : streamEvents.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
    return mergeEvents(filteredSeedEvents, filteredStreamEvents, maxBuffer);
  }, [clearCutoff, maxBuffer, seedEvents, streamEvents]);

  const connectionState: ConnectionState = !enabled
    ? "idle"
    : isPaused
      ? "paused"
      : streamState;

  useEffect(() => {
    if (!enabled) {
      clearReconnectTimer();
      closeStream();
      return;
    }
    if (isPaused) {
      clearReconnectTimer();
      closeStream();
      return;
    }
    openStream();
    return () => {
      clearReconnectTimer();
      closeStream();
    };
  }, [clearReconnectTimer, closeStream, enabled, isPaused, openStream]);

  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setIsPaused(false);
    setStreamState("connecting");
  }, []);

  const clear = useCallback(() => {
    setClearCutoff(Date.now());
    setStreamEvents([]);
  }, []);

  return {
    events,
    connectionState,
    errorMessage,
    isPaused,
    pause,
    resume,
    clear,
  };
}
