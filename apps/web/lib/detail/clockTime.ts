/** HH:MM of an ISO timestamp in the viewer's time zone and locale; "" when there is none or it is not a valid timestamp. */
export function clockTime(iso: string | null, locale: "en" | "ko"): string {
  if (iso === null || Number.isNaN(new Date(iso).getTime())) return "";
  return new Date(iso).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** MM-DD HH:MM of an ISO timestamp, both from the same instant in the viewer's time zone; "" when there is none or it is invalid. */
export function dayAndTime(iso: string | null, locale: "en" | "ko"): string {
  const time = clockTime(iso, locale);
  if (time === "" || iso === null) return "";
  const moment = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(moment.getMonth() + 1)}-${pad(moment.getDate())} ${time}`;
}
