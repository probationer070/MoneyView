import { tabStateKey } from "@/lib/tabState";

// Spec §2A (D10): the corporate page's four tabs, in order.
export const PAGE_TABS = ["summary", "diagnostics", "dcf", "comparison"] as const;
export type PageTabKey = (typeof PAGE_TABS)[number];

export const PAGE_TAB_KEY = tabStateKey("corporate", "pageTab");
/** Where the three lower tabs kept their choice before D10 (plan Task 6). */
export const LEGACY_LOWER_TAB_KEY = tabStateKey("corporate", "lowerTab");

export const isPageTab = (value: unknown): value is PageTabKey =>
  typeof value === "string" && (PAGE_TABS as readonly string[]).includes(value);

/**
 * Moves a pre-D10 lower-tab choice to the page-tab key, once: the old key is always removed.
 * Only "dcf" and "comparison" move. "diagnostics" was the old default, and useTabState writes its
 * value back on every mount, so a stored "diagnostics" does not mean the reader chose it (plan N12).
 * A page tab that is already stored wins.
 */
export function migrateLowerTab(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  const legacy = storage.getItem(LEGACY_LOWER_TAB_KEY);
  if (legacy === null) return;
  storage.removeItem(LEGACY_LOWER_TAB_KEY);
  if (storage.getItem(PAGE_TAB_KEY) !== null) return;
  let value: unknown;
  try {
    value = JSON.parse(legacy);
  } catch {
    return; // written by an older shape; Summary is the honest default
  }
  if (value === "dcf" || value === "comparison") storage.setItem(PAGE_TAB_KEY, legacy);
}
