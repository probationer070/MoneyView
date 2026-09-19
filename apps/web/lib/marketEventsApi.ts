import { buildApiUrl } from "@/lib/api";
import type {
  EventCategory,
  EventCategoryInput,
  EventCategoryPatch,
  MarketEvent,
  MarketEventInput,
} from "../../../packages/shared-types";

/**
 * Writes for events and categories. Not fetchApi: that throws "API error: 422 Unprocessable
 * Entity" and drops the body, and the server's `detail` is the only thing that tells the user
 * which field to fix.
 */
export class EventApiError extends Error {
  public constructor(public readonly status: number, public readonly detail: string) {
    super(detail);
  }
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI's own 422: [{loc: ["body", "field"], msg}].
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) => `${(item.loc ?? []).slice(1).join(".")}: ${item.msg ?? "invalid"}`)
      .join("; ");
  }
  return fallback;
}

async function send<T>(endpoint: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(buildApiUrl(endpoint).toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;
    let detail = fallback;
    try {
      detail = describeDetail((await response.json())?.detail, fallback);
    } catch {
      // Not JSON: keep the status line.
    }
    throw new EventApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const id = (value: string) => encodeURIComponent(value);

export const eventsApi = {
  createEvent: (input: MarketEventInput) => send<MarketEvent>("/market/events", "POST", input),
  updateEvent: (eventId: string, input: MarketEventInput) => send<MarketEvent>(`/market/events/${id(eventId)}`, "PUT", input),
  deleteEvent: (eventId: string) => send<void>(`/market/events/${id(eventId)}`, "DELETE"),
  createCategory: (input: EventCategoryInput) => send<EventCategory>("/market/event-categories", "POST", input),
  patchCategory: (categoryId: string, patch: EventCategoryPatch) =>
    send<EventCategory>(`/market/event-categories/${id(categoryId)}`, "PATCH", patch),
  resetCategory: (categoryId: string) => send<void>(`/market/event-categories/${id(categoryId)}/override`, "DELETE"),
  deleteCategory: (categoryId: string) => send<void>(`/market/event-categories/${id(categoryId)}`, "DELETE"),
};
