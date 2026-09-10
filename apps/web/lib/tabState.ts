"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-tab state that survives navigating away and back.
 *
 * Every tab is its own route, so moving between them unmounts the component tree and
 * every `useState` in it resets. A search typed on Portfolio, a filter chosen there, the
 * ticker being valued -- all of it had to be retyped on return.
 *
 * `sessionStorage`, deliberately, not `localStorage`. A filter restored days later would
 * quietly show a subset of the watchlist with nothing on screen explaining why, which is
 * the same shape as the defects this project keeps recording: a view wearing a basis the
 * reader cannot see. Losing it when the tab closes is the honest trade.
 *
 * Keys are namespaced per tab and per concern by the caller, so two tabs that both keep a
 * "search" cannot read each other's.
 */

const NAMESPACE = "moneyview.tab";

export function tabStateKey(tab: string, concern: string): string {
  return `${NAMESPACE}.${tab}.${concern}`;
}

export function readTabState<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    // A private window, cleared storage, or a value written by an older shape. Falling
    // back to the initial value is always safe; throwing here would blank the tab.
    return null;
  }
}

export function writeTabState<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked outright. Persistence is a convenience; failing to
    // save must never break the interaction that triggered it.
  }
}

/**
 * `useState`, but restored from this tab's session state on mount.
 *
 * The initial render deliberately uses `initial` rather than the stored value, and the
 * stored value is applied in an effect. Reading storage during render makes the server
 * and client disagree, and Next hydration then discards the client's answer -- the state
 * would appear to restore and then silently revert.
 *
 * A cleared value is restored as cleared: an empty search is a deliberate act, and
 * "restore the last non-empty value" would make clearing impossible to keep.
 */
export function useTabState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // Restoring from an external store on mount is what an effect is for, and the lint
    // rule's usual remedy -- a lazy `useState` initializer -- cannot be used here: this
    // runs inside client components that Next still renders on the server, so reading
    // sessionStorage during render makes the two disagree and hydration discards the
    // client's answer. The state would appear to restore and then silently revert.
    //
    // The cascade is bounded: one extra render on mount, once per key.
    const stored = readTabState<T>(key);
    setValue(stored === null ? initial : stored);
    setRestored(true);
    // `initial` is deliberately not a dependency: callers pass literals and fresh objects,
    // and depending on it would re-run this on every render and clobber the user's value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    // Not before the restore has run, or the initial value would overwrite what is stored
    // in the same tick the component mounted.
    if (restored) writeTabState(key, value);
  }, [key, restored, value]);

  const set = useCallback((next: T) => setValue(next), []);
  return [value, set];
}
