import type { Messages } from "./messages/en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

/** An unknown key returns itself, so a missing string is visible on screen, not blank. */
export function translate(messages: Messages, key: MessageKey, params?: Record<string, string | number>): string {
  const raw = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  if (typeof raw !== "string") return key;
  return params ? raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : raw;
}
