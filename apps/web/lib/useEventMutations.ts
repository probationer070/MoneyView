"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/marketEventsApi";
import { EVENT_CATEGORIES_KEY, MARKET_EVENTS_KEY } from "@/lib/useMarketEvents";
import type { EventCategory, EventCategoryInput, EventCategoryPatch, MarketEventInput } from "../../../packages/shared-types";

/** Every write can change what either list resolves to (a category rename, a fallback), so both refetch. */
function useEventsWrite<TArgs, TResult>(write: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MARKET_EVENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
  });
}

export const useCreateEvent = () => useEventsWrite((input: MarketEventInput) => eventsApi.createEvent(input));
export const useUpdateEvent = () =>
  useEventsWrite(({ id, input }: { id: string; input: MarketEventInput }) => eventsApi.updateEvent(id, input));
export const useDeleteEvent = () => useEventsWrite((id: string) => eventsApi.deleteEvent(id));
export const useCreateCategory = () => useEventsWrite((input: EventCategoryInput) => eventsApi.createCategory(input));
export const usePatchCategory = () =>
  useEventsWrite(({ id, patch }: { id: string; patch: EventCategoryPatch }) => eventsApi.patchCategory(id, patch));
export const useResetCategory = () => useEventsWrite((id: string) => eventsApi.resetCategory(id));
export const useDeleteCategory = () => useEventsWrite((id: string) => eventsApi.deleteCategory(id));

/**
 * The global filter. Optimistic, so every chart updates on the click.
 *
 * The optimistic cache write happens synchronously in `mutate`, before the mutation starts, so
 * the controlled checkbox reading `category.visible` never renders the pre-click value: TanStack's
 * own mutation dispatch also re-renders every observer, and if the cache write happened only
 * inside `onMutate` (necessarily async -- an `onMutate` handler always resolves at least one tick
 * later, even doing no awaited work itself), that dispatch's render would land first, showing the
 * old value.
 *
 * `cancelQueries` is fired and not awaited: query-core cancels an in-flight fetch by rejecting its
 * promise synchronously and reverting the query to its last good data, so there is nothing this
 * call needs to wait for before the next line reads that data.
 *
 * A change can be `["a", "b"]` (the "All"/"None" buttons) and only one PATCH can fail -- restoring
 * the whole snapshot to `previous` on any single failure would silently undo the ones that
 * succeeded. On failure the categories are instead refetched, so the filter shows exactly what the
 * server actually saved, whichever changes that turned out to be.
 */
export function useSetCategoriesVisible() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (changes: Array<{ id: string; visible: boolean }>) =>
      Promise.all(changes.map((change) => eventsApi.patchCategory(change.id, { visible: change.visible }))),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
  });

  const mutate = useCallback(
    (changes: Array<{ id: string; visible: boolean }>) => {
      if (changes.length === 0) return;
      void queryClient.cancelQueries({ queryKey: EVENT_CATEGORIES_KEY });
      const next = new Map(changes.map((change) => [change.id, change.visible]));
      queryClient.setQueryData<EventCategory[]>(EVENT_CATEGORIES_KEY, (current) =>
        current?.map((category) => (next.has(category.id) ? { ...category, visible: next.get(category.id)! } : category)),
      );
      mutation.mutate(changes);
    },
    [queryClient, mutation.mutate],
  );

  return { mutate, isError: mutation.isError, isPending: mutation.isPending };
}
