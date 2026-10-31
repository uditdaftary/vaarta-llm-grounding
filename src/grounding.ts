/**
 * Deterministic grounding check for a model-written claim.
 *
 * You show the model N numbered source items and ask it to cite them as [S1], [S2].
 * validateGrounded then checks, with no network and no second model:
 *   1. at least one source item was provided;
 *   2. the claim carries at least one [S<n>] marker, and every marker points at a
 *      real item (1..N);
 *   3. every number in the claim, marker text excluded, appears somewhere in the
 *      source items. An invented figure is the classic failure this catches.
 *
 * It does not check that a cited item actually supports the sentence it is attached
 * to, and it does not check claims that contain no digits. The README lists the limits.
 *
 * The check is strict on purpose: it reports failures and the caller drops the claim.
 * Nothing here softens a claim and lets it through.
 */
export interface BasisSignal {
  id?: string;
  title: string;
  summary: string;
  signal_type?: string;
  /** Any date string. It is searched for numbers like the title and summary are. */
  detected_at?: string;
}

export interface GroundingInput {
  claim: string;
  /** The items the model was shown, in the order it saw them: [S1] is element 0. */
  basisSignals: BasisSignal[];
}

export interface GroundingResult {
  grounded: boolean;
  /** One human-readable line per problem found. Empty when grounded. */
  failures: string[];
}

const MARKER = /\[S(\d+)\]/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?%?/g;
// Gemini often groups citations as "[S13, S18]" even when the prompt shows "[S2][S5]".
// In the first live run every one of 34 claims used the grouped form, so all 34 were
// dropped and about 26k tokens were wasted. Only brackets whose content is purely
// comma or semicolon separated S-refs are rewritten; other brackets are left alone.
const GROUPED_MARKERS = /\[\s*S\d+(?:\s*[,;]\s*S\d+)+\s*\]/g;

/** Pure and idempotent: "[S13, S18]" becomes "[S13][S18]"; canonical claims pass through. */
export function normalizeCitations(claim: string): string {
  return claim.replace(GROUPED_MARKERS, (m) => (m.match(/S\d+/g) ?? []).map((s) => `[${s}]`).join(''));
}

export function validateGrounded(input: GroundingInput): GroundingResult {
  const failures: string[] = [];
  if (input.basisSignals.length === 0) failures.push('no basis signals provided');

  const claim = normalizeCitations(input.claim);
  const markers = [...claim.matchAll(MARKER)].map((m) => Number(m[1]));
  if (markers.length === 0) failures.push('claim carries no [Sn] citation');
  for (const n of markers) {
    if (n < 1 || n > input.basisSignals.length) failures.push(`citation S${n} does not exist in basis`);
  }

  const basisText = input.basisSignals.map((b) => `${b.title} ${b.summary} ${b.detected_at ?? ''}`).join(' ');
  const basisNumbers = new Set((basisText.match(NUMBER) ?? []).map((t) => t.replace(/,/g, '')));
  const claimSansMarkers = claim.replace(MARKER, '');
  for (const tok of claimSansMarkers.match(NUMBER) ?? []) {
    if (!basisNumbers.has(tok.replace(/,/g, ''))) failures.push(`numeric token "${tok}" not present in any basis signal`);
  }

  return { grounded: failures.length === 0, failures };
}
