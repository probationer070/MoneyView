"use client";

import { useCallback, useSyncExternalStore } from "react";
import { en } from "./messages/en";
import { ko } from "./messages/ko";
import { translate, type MessageKey } from "./translate";

export type Locale = "en" | "ko";
const STORAGE_KEY = "moneyview.locale";
const CATALOGS = { en, ko };
const listeners = new Set<() => void>();

export function detectLocale(stored: string | null, browser: string | undefined): Locale {
  if (stored === "en" || stored === "ko") return stored;
  return browser?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

// The server renders English; the client switches after hydration without a mismatch.
const getSnapshot = (): Locale => detectLocale(window.localStorage.getItem(STORAGE_KEY), window.navigator.language);
const getServerSnapshot = (): Locale => "en";

function setLocale(next: Locale) {
  window.localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((listener) => listener());
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { locale, setLocale };
}

export function useT() {
  const { locale } = useLocale();
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(CATALOGS[locale], key, params),
    [locale],
  );
}
