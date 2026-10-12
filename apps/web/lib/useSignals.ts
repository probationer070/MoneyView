"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type {
  ManualInputSaved, ManualState, SignalHistoryPoint, SignalRules, SignalSnapshot,
} from "../../../packages/shared-types";

export const SIGNALS_LATEST_KEY = ["signals-latest"] as const;
export const SIGNALS_HISTORY_KEY = ["signals-history"] as const;
export const SIGNALS_RULES_KEY = ["signals-rules"] as const;

export function useSignals() {
  const queryClient = useQueryClient();
  const latest = useQuery({ queryKey: SIGNALS_LATEST_KEY, queryFn: () => fetchApi<SignalSnapshot | null>("/signals/latest"), retry: 1 });
  const history = useQuery({
    queryKey: SIGNALS_HISTORY_KEY,
    queryFn: () => fetchApi<SignalHistoryPoint[]>("/signals/history", { params: { weeks: 26 } }),
    retry: 1,
  });
  const rules = useQuery({ queryKey: SIGNALS_RULES_KEY, queryFn: () => fetchApi<SignalRules>("/signals/rules"), staleTime: Infinity, retry: 1 });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SIGNALS_LATEST_KEY });
    void queryClient.invalidateQueries({ queryKey: SIGNALS_HISTORY_KEY });
  };
  const run = useMutation({
    mutationFn: () => fetchApi<SignalSnapshot>("/signals/run", { method: "POST" }),
    onSuccess: (snapshot) => { queryClient.setQueryData(SIGNALS_LATEST_KEY, snapshot); refresh(); },
  });
  const manual = useMutation({
    mutationFn: ({ ruleId, state, note }: { ruleId: string; state: ManualState; note: string }) =>
      fetchApi<ManualInputSaved>(`/signals/manual/${ruleId}`, { method: "PUT", body: JSON.stringify({ state, note }) }),
    onSuccess: refresh,
  });
  const queries = [latest, history, rules];
  const status: "loading" | "ready" | "unavailable" = queries.some((q) => q.isError)
    ? "unavailable"
    : queries.some((q) => q.isPending) ? "loading" : "ready";
  return {
    latest: latest.data ?? null,
    history: history.data ?? [],
    manualRules: (rules.data?.rules ?? []).filter((r) => r.kind === "manual"),
    status,
    runNow: () => run.mutate(),
    running: run.isPending,
    lastRunFailed: run.isError,
    lastRunFailures: run.data?.failures ?? latest.data?.failures ?? [],
    saveManual: manual.mutateAsync,
  };
}
