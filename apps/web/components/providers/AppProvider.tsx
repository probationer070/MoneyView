"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, useEffect, ReactNode } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { discoverBackendPort } from "@/app/actions/discovery";
import { setDynamicPort } from "@/lib/api";

export function AppProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Enforce strict UX caching limits preventing UI jitter
        staleTime: 1000 * 60 * 1, // 1 minute
        gcTime: 1000 * 60 * 5,    // 5 minutes
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 3,
      },
    },
  }));

  const [isBackendReady, setIsBackendReady] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isPolling = true;
    let delay = 500; // Exponential backoff starts at 500ms
    const maxDelay = 5000;
    const timeoutThreshold = 30000;
    let elapsed = 0;

    const checkBackend = async () => {
      if (!isPolling) return;
      if (elapsed > timeoutThreshold) {
        setHasFailed(true);
        return;
      }

      try {
        const explicitBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        const port = explicitBaseUrl
          ? Number(new URL(explicitBaseUrl).port || "8000")
          : await discoverBackendPort();
        setDynamicPort(port);

        const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
        if (res.ok && isPolling) {
          setIsBackendReady(true);
          return;
        }
      } catch {
        if (isPolling) {
          elapsed += delay;
          setTimeout(checkBackend, delay);
          delay = Math.min(delay * 2, maxDelay); // Exponential backoff curve
        }
      }
    };

    // Begin check cascade
    setTimeout(checkBackend, delay);

    return () => {
      isPolling = false;
    };
  }, []);

  if (hasFailed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 text-red-900 border-2 border-red-200">
        <AlertTriangle className="h-12 w-12 text-red-600 mb-4 animate-pulse" />
        <h2 className="text-xl font-bold tracking-tight">System Boot Failure</h2>
        <p className="text-sm mt-2 max-w-sm text-center">
          The core Python analytics engine failed to start or coordinate properly within the 30-second initialization limit.
        </p>
      </div>
    );
  }

  if (!isBackendReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <Activity className="h-12 w-12 text-[var(--surface)] animate-bounce mb-4" />
        <h2 className="text-xl font-bold tracking-tight">Starting Core Analytics...</h2>
        <p className="text-sm text-[var(--text-muted)] mt-2">Discovering dynamic port mapping & initiating connection.</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV !== "production" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
