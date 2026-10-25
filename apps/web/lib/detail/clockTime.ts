/** HH:MM of an ISO timestamp in the viewer's time zone and locale; "" when there is none. */
export function clockTime(iso: string | null, locale: "en" | "ko"): string {
  if (iso === null) return "";
  return new Date(iso).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
