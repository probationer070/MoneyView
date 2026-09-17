import { expect, type Locator, type Page, type Route } from "@playwright/test";

/**
 * A stateful stand-in for the events and categories API. State lives in this test's closure, so a
 * filter change survives page.reload() the way the real database does, and never leaks into the
 * next test the way a PATCH against the shared e2e API database would.
 *
 * Register it AFTER any catch-all page mock: Playwright tries the last-registered route first.
 */

export interface MockCategory {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  origin: "builtin" | "user";
  overridden: boolean;
}

export interface MockEvent {
  id: string;
  label: string;
  category: string;
  start_date: string;
  end_date?: string | null;
  source?: string | null;
  note?: string;
  origin?: "builtin" | "rule" | "user";
  missing_category?: string | null;
}

export const GEOPOLITICAL: MockCategory = { id: "geopolitical", label: "Geopolitical", color: "#E8A028", visible: true, origin: "builtin", overridden: false };
export const FOMC_CATEGORY: MockCategory = { id: "fomc", label: "Fed rate decisions", color: "#E54545", visible: true, origin: "builtin", overridden: false };
export const UNCATEGORIZED: MockCategory = { id: "uncategorized", label: "Uncategorized", color: "#9DA5A2", visible: true, origin: "builtin", overridden: false };

export interface MockEventsState {
  events: Required<MockEvent>[];
  categories: MockCategory[];
  patches: Array<{ id: string; body: Record<string, unknown> }>;
}

interface Options {
  events?: MockEvent[];
  categories?: MockCategory[];
  /** Fail GET /market/event-categories with this status. */
  categoriesStatus?: number;
  /** Hold GET /market/events until this settles. */
  holdEvents?: Promise<void>;
}

function normalize(event: MockEvent): Required<MockEvent> {
  return { end_date: null, source: null, note: "", origin: "builtin", missing_category: null, ...event };
}

async function reply(route: Route, status: number, body?: unknown) {
  if (status === 204) return route.fulfill({ status, body: "" });
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function mockEventsApi(page: Page, options: Options = {}): Promise<MockEventsState> {
  const state: MockEventsState = {
    events: (options.events ?? []).map(normalize),
    categories: (options.categories ?? [GEOPOLITICAL]).map((category) => ({ ...category })),
    patches: [],
  };
  const defaults = new Map(state.categories.filter((c) => c.origin === "builtin").map((c) => [c.id, { label: c.label, color: c.color }]));
  let nextUserEvent = 1 + state.events.filter((e) => e.origin === "user").length;

  await page.route("**/api/v1/market/event-categories**", async (route) => {
    const request = route.request();
    const method = request.method();
    const rest = new URL(request.url()).pathname.replace(/^.*\/market\/event-categories/, "");
    if (rest === "" && method === "GET") {
      return options.categoriesStatus ? reply(route, options.categoriesStatus, { detail: "unavailable" }) : reply(route, 200, state.categories);
    }
    if (rest === "" && method === "POST") {
      const body = request.postDataJSON() as { label: string; color: string };
      const category: MockCategory = {
        id: `user-${body.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        label: body.label, color: body.color, visible: true, origin: "user", overridden: false,
      };
      state.categories.push(category);
      return reply(route, 201, category);
    }
    const match = rest.match(/^\/([^/]+)(\/override)?$/);
    const category = match ? state.categories.find((c) => c.id === decodeURIComponent(match[1])) : undefined;
    if (!match || !category) return reply(route, 404, { detail: "no such category" });
    if (match[2] && method === "DELETE") {
      const original = defaults.get(category.id);
      if (!original) return reply(route, 409, { detail: "a user category has no file default" });
      Object.assign(category, original, { overridden: false });
      return reply(route, 204);
    }
    if (method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.patches.push({ id: category.id, body });
      Object.assign(category, body);
      const original = defaults.get(category.id);
      if (original) category.overridden = category.label !== original.label || category.color.toUpperCase() !== original.color.toUpperCase();
      return reply(route, 200, category);
    }
    if (method === "DELETE") {
      if (category.origin === "builtin") return reply(route, 409, { detail: "built-in categories cannot be deleted" });
      const used = state.events.filter((e) => e.origin === "user" && e.category === category.id).length;
      if (used) return reply(route, 409, { detail: `category '${category.id}' is still used by ${used} event${used === 1 ? "" : "s"}` });
      state.categories = state.categories.filter((c) => c !== category);
      return reply(route, 204);
    }
    return route.fallback();
  });

  await page.route("**/api/v1/market/events**", async (route) => {
    const request = route.request();
    const method = request.method();
    const rest = new URL(request.url()).pathname.replace(/^.*\/market\/events/, "");
    if (rest === "" && method === "GET") {
      if (options.holdEvents) await options.holdEvents;
      return reply(route, 200, state.events);
    }
    const body = method === "POST" || method === "PUT" ? (request.postDataJSON() as MockEvent) : null;
    if (body && body.end_date && body.end_date < body.start_date) {
      return reply(route, 422, { detail: `event ends (${body.end_date}) before it starts (${body.start_date})` });
    }
    if (rest === "" && method === "POST" && body) {
      const created = normalize({ ...body, id: `user-${nextUserEvent++}`, origin: "user" });
      state.events.push(created);
      return reply(route, 201, created);
    }
    const eventId = decodeURIComponent(rest.replace(/^\//, ""));
    const existing = state.events.find((e) => e.id === eventId);
    if (!existing) return reply(route, 404, { detail: `no event with id '${eventId}'` });
    if (existing.origin !== "user") return reply(route, 409, { detail: "built-in events are edited in their data file" });
    if (method === "PUT" && body) {
      Object.assign(existing, normalize({ ...body, id: existing.id, origin: "user" }));
      return reply(route, 200, existing);
    }
    if (method === "DELETE") {
      state.events = state.events.filter((e) => e !== existing);
      return reply(route, 204);
    }
    return route.fallback();
  });

  return state;
}

/** Show or hide every category through the filter, then close it. */
export async function setAllEventCategories(scope: Page | Locator, testId: string, shown: boolean) {
  const button = scope.getByTestId(testId);
  await button.click();
  await scope.getByTestId(`${testId}-${shown ? "all" : "none"}`).click();
  await expect(button).toHaveText(shown ? /Events · (\d+) of \1$/ : /Events · 0 of \d+$/);
  await button.click();
  await expect(scope.getByTestId(`${testId}-popover`)).toHaveCount(0);
}
