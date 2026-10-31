# vaarta-llm-grounding

Two small checks for pipelines that ask an LLM to write claims from source material.

1. **`validateGrounded`** checks a model-written claim against the numbered sources the model was shown. The claim must cite at least one source, every citation must point at a real source, and every number in the claim must appear in a source. No network call and no second model.
2. **`classifySynthesisFailure`** tells a Gemini call that failed in transit (quota, 5xx, dropped connection) from one where the model answered with something unusable.

> **Built for Vaarta, released for everyone.** [Vaarta](https://vaartahq.com) is a competitive intelligence service. It has an LLM write findings from collected web evidence, and these two checks decide which findings are allowed through and which failures are the provider's fault. They were built for that job. Vaarta has pulled them out into their own repository, with Vaarta-specific names removed, and is open sourcing them for the public good under the MIT license.

## The failure this catches

You show the model a numbered list of source items and ask it to cite them as `[S1]`, `[S2]`. Models sometimes invent figures: a churn rate, a price, a percentage that appears in none of the sources. A claim with a citation marker looks supported, so the invented number reads as fact.

`validateGrounded` is a deterministic gate in front of that. It does not ask a second model to judge the first. It reports the failures, and your code drops the claim. Nothing in it softens a claim and lets it through.

## Install

There is no npm package. Each check is one file with no build step.

- `src/grounding.ts` has no dependencies.
- `src/transport.ts` has no runtime dependency. It is written against the message formats of `@google/generative-ai` 0.24.x.

Copy the file you need into your project. Node 22 or newer.

## Check a claim against its sources

```ts
import { validateGrounded } from './grounding';

const basisSignals = [
  { title: 'Entry tier raised from $29 to $49 per month', summary: 'Pricing page now lists $49 as the lowest paid plan.', detected_at: '2026-07-14' },
  { title: 'Starter plan removed from the pricing page', summary: 'The $29 Starter tier no longer appears.', detected_at: '2026-07-28' },
];
```

`basisSignals[0]` is `[S1]`, the order the model saw them in.

A claim whose figures all come from the sources passes:

```ts
validateGrounded({
  claim: 'Entry pricing moved from $29 to $49 in eight weeks, which is consistent with a deliberate move upmarket rather than a one-off test [S1][S2].',
  basisSignals,
});
// { grounded: true, failures: [] }
```

A claim with an invented figure fails, and the failure names it:

```ts
validateGrounded({
  claim: 'Entry pricing moved from $29 to $49, and roughly 40% of their customers churned as a result [S1][S2].',
  basisSignals,
});
// { grounded: false, failures: ['numeric token "40%" not present in any basis signal'] }
```

The other failures it reports:

| Problem | Failure text |
|---|---|
| No citation marker at all | `claim carries no [Sn] citation` |
| Marker outside the list | `citation S3 does not exist in basis` |
| Empty source list | `no basis signals provided` |

## Grouped citations are fixed before checking

Models often write `[S1, S2]` even when the prompt shows `[S1][S2]`. In the first live run of the original pipeline, all 34 claims used the grouped form, so a strict marker check dropped all 34 and about 26,000 tokens were wasted. `normalizeCitations` rewrites a bracket that holds only comma or semicolon separated source references, and leaves every other bracket alone:

```ts
normalizeCitations('Prices rose [S1, S2] and fell [S2; S1].');
// 'Prices rose [S1][S2] and fell [S2][S1].'
```

It is pure and idempotent, and `validateGrounded` calls it for you. Call it yourself on the claim before you store it, and in any other code that reads `[Sn]` markers.

## What it does not catch

This is a check on figures and citation shape, not on meaning. These all pass, and the test suite pins each one so this list cannot drift from the code:

- **A number written as a word.** "Forty customers left" passes, because only digit tokens are compared.
- **A real citation on a sentence it does not support.** "The Starter plan was removed [S1]" passes even though `[S1]` is about the entry tier. It checks that the marker exists, not that the source supports the sentence.
- **A prediction with no new number.** "They will lose customers as a result" passes.
- **A reasoning error built from true figures.** If every number is in the sources, the claim passes whether or not the conclusion follows.

Use it as the cheap first filter. It removes a class of fabrication for free, and it does not replace review of what the model concluded.

## Tell a transport failure from a bad answer

When a synthesis call fails, what you do next depends on why. A quota error or a 503 is the provider's problem, so you retry or report an outage. An unusable body is the model's answer, so you tighten the prompt. A 400 from a bad key or a retired model name is your configuration.

```ts
import { classifySynthesisFailure } from './transport';

try {
  // your Gemini call
} catch (err) {
  switch (classifySynthesisFailure(err)) {
    case 'transport': /* retry later, count it as a provider failure */ break;
    case 'malformed': /* the model answered, but not usably */ break;
    case 'other': /* your bug or your configuration: log it where you catch it */ break;
  }
}
```

| The error message contains | Result |
|---|---|
| `Error fetching from <url>:` followed by a 429 or any 5xx | `transport` |
| `Error fetching from <url>:` with no status, such as `fetch failed` | `transport` |
| `Request aborted when fetching` (a timeout) | `transport` |
| `Gemini response body lost in transit` (you throw this yourself, see below) | `transport` |
| `Too Many Requests`, `Quota exceeded`, `RESOURCE_EXHAUSTED` | `transport` |
| `no usable text`, `finishReason=`, a JSON parse failure | `malformed` |
| A 400, 401, 403 or 404 from the SDK, a database error, anything else | `other` |

Three details that cost real debugging time:

- **Match the message, never the class name.** The SDK's errors keep `name === 'Error'`. A pattern on the class name counted zero transport failures through two real 503s. The tests build errors from the SDK's own classes so this cannot regress.
- **A 4xx is not an outage.** A bad key or a retired model name returns 400 or 404. Counting it as `transport` would make a configuration mistake look like a Google outage, so it stays `other`.
- **A connection lost after the headers escapes the SDK's wrapper.** The SDK reads the body outside its error handling, so a truncated body would surface as a JSON failure and be classified `malformed`, which means the model answered. Re-throw it yourself as `new Error('Gemini response body lost in transit: ' + cause)` and it classifies as `transport`.

## What is not covered

- `transport.ts` is tuned to the Gemini JS SDK 0.24.x message formats. Another SDK, or a later version that rewords its errors, needs its signature checked against real errors.
- `validateGrounded` reads digit tokens from the claim and from each source's `title`, `summary` and `detected_at`. A source whose figures live in a field you did not pass in will make true claims fail.
- Neither check calls a model or the network.

## Run the tests

```bash
npm install
npm run typecheck
npm test
```

The grounding tests cover nine groups, including the two examples above. The transport tests build errors from the SDK's own classes with no network.

## FAQ

**Why not ask a second model to verify the claim?** It costs another call per claim, it can be wrong in the same way, and it cannot be unit tested. A digit that is or is not in the source is a fact you can assert.

**Does it work with models other than Gemini?** `validateGrounded` is model-agnostic. It only needs claims with `[Sn]` markers and the source list. `classifySynthesisFailure` is Gemini-specific.

**Will it reject a correct claim?** Yes, if a true figure is not in the sources you passed, for example one the model derived by arithmetic. Strict is deliberate here: the cost of dropping a true claim is lower than the cost of shipping an invented one.

## License

MIT. See [LICENSE](LICENSE).
