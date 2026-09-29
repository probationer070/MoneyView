import { getApiBaseUrl } from "@/lib/api";
import { knownRefusalText } from "@/lib/impliedReturn";

/**
 * A DCF the backend declined to produce (HTTP 422 {detail: {code, message}}), e.g.
 * non_positive_fcff. Content for the reader, not a failure: callers render it in place of
 * the value rather than as an error state.
 */
export class DcfRefusalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DcfRefusalError";
    this.code = code;
  }

  /**
   * The reader's sentence: the shared map's wording when it knows the code, else the server's
   * own message. The routes forward every engine refusal code, not only the mapped ones, and
   * a raw code like `wacc_not_above_growth` is not a sentence.
   */
  get readerText(): string {
    return knownRefusalText(this.code) ?? this.message;
  }
}

export async function readDcfRefusal(response: Response): Promise<DcfRefusalError | null> {
  if (response.status !== 422) return null;
  try {
    const body = await response.clone().json();
    const detail = body?.detail;
    if (detail && typeof detail.code === "string") {
      return new DcfRefusalError(detail.code, String(detail.message ?? detail.code));
    }
  } catch {
    // Not a refusal body (e.g. a pydantic validation 422): fall through to the caller's error path.
  }
  return null;
}

/** POST to a DCF route, throwing DcfRefusalError for a refusal and Error for anything else. */
export async function postDcf<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const refusal = await readDcfRefusal(response);
  if (refusal) throw refusal;
  if (!response.ok) throw new Error(`DCF request failed: ${response.status}`);
  // The same envelope handling as fetchApi: prefer `data`, accept a raw payload.
  const payload = await response.json();
  return (payload?.data ?? payload) as T;
}
