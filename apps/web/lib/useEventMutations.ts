"use client";

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
 * The global filter. Optimistic, so every chart updates on the click; a failed save rolls the
 * cache back to what the server holds, and the caller shows the error.
 */
export function useSetCategoriesVisible() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Array<{ id: string; visible: boolean }>) =>
      Promise.all(changes.map((change) => eventsApi.patchCategory(change.id, { visible: change.visible }))),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: EVENT_CATEGORIES_KEY });
      const previous = queryClient.getQueryData<EventCategory[]>(EVENT_CATEGORIES_KEY);
      const next = new Map(changes.map((change) => [change.id, change.visible]));
      queryClient.setQueryData<EventCategory[]>(EVENT_CATEGORIES_KEY, (current) =>
        current?.map((category) => (next.has(category.id) ? { ...category, visible: next.get(category.id)! } : category)),
      );
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(EVENT_CATEGORIES_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
  });
}
