/**
 * Did this Gemini call fail in transit, or did the model answer?
 *
 * Written against @google/generative-ai 0.24.x (the Gemini JS SDK). Its errors keep
 * name 'Error', so a class-name match counts nothing: in one production run it read
 * zero transport failures through two 503s. The signature has to match the MESSAGE.
 *
 * Every failed request the SDK sends reads "Error fetching from <url>: ...", so the
 * pattern anchors on what follows that prefix: a 429 or 5xx status, or no status at
 * all (a socket failure such as "fetch failed"). A 400, 401, 403 or 404 is a
 * configuration fault (a bad key, a retired model name, an oversize payload) and
 * stays 'other'. Counting it as transit would read as a Google outage.
 *
 * A timeout reads "Request aborted when fetching <url>". A connection lost AFTER the
 * response headers is not wrapped by the SDK (its response.json() call sits outside
 * the wrapper), so re-throw it yourself as "Gemini response body lost in transit";
 * otherwise a truncated body reads as 'malformed', which means the model answered.
 * The quota strings stay for a bare 429 body. Pure and network-free.
 */

export const TRANSPORT_SIGNATURE = /Error fetching from \S+: (?:\[(?:429|5\d\d) |(?!\[))|Request aborted when fetching|Gemini response body lost in transit|Too Many Requests|Quota exceeded|RESOURCE_EXHAUSTED/;

/** finishReason and JSON-parse failures: the call completed and the body was unusable. */
export const MALFORMED_SIGNATURE = /no usable text|finishReason=|Unexpected token|Unexpected end of JSON|is not valid JSON|in JSON at position/i;

function messageOf(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return err === null || err === undefined ? '' : String(err);
}

export function isTransportError(err: unknown): boolean {
  return TRANSPORT_SIGNATURE.test(messageOf(err));
}

/**
 * 'transport' means quota, 5xx or socket. 'malformed' means the model answered and the
 * body was unusable. 'other' means neither, for example a database or programming
 * error inside your own pass; log it where you catch it.
 */
export function classifySynthesisFailure(err: unknown): 'transport' | 'malformed' | 'other' {
  const text = messageOf(err);
  if (TRANSPORT_SIGNATURE.test(text)) return 'transport';
  if (MALFORMED_SIGNATURE.test(text)) return 'malformed';
  return 'other';
}
