// Small Gmail REST helper shared by the A6 actions: JSON in/out, timeouts, and retries for
// rate limits and server errors. Errors carry only the HTTP status, never response text.

import { GOOGLE_TIMEOUT_MS } from "./oauth";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_TRIES = 3;

export class GmailError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gmailRequest<T>(
  accessToken: string,
  path: string,
  init: { method?: "GET" | "POST"; params?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${GMAIL}${path}`);
  for (const [k, value] of Object.entries(init.params ?? {})) url.searchParams.set(k, value);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (res.ok) return (res.status === 204 ? null : await res.json()) as T;
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimit/i.test(await res.clone().text()));
    if ((rateLimited || res.status >= 500) && attempt < MAX_TRIES) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2 ** attempt * 250);
      continue;
    }
    throw new GmailError(res.status);
  }
}
