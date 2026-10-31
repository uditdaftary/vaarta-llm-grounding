/**
 * Network-free tests for the grounding validator.
 * Run: npm test   (or: npx tsx test/grounding.test.ts)
 */
import { validateGrounded, normalizeCitations } from '../src/grounding';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

// Acme is a made-up company. The test data is fictional on purpose.
const basis = [
  {
    id: 'a1',
    title: 'Acme raised prices to $19',
    summary: 'Pro tier moved from $15 to $19 on 2026-06-20.',
    signal_type: 'pricing_change',
    detected_at: '2026-06-20',
  },
  {
    id: 'b2',
    title: 'Acme launched API access',
    summary: 'Public API announced.',
    signal_type: 'feature_launch',
    detected_at: '2026-05-01',
  },
];

function main(): void {
  // 1. Valid: cites existing markers, numbers appear in the basis.
  const ok = validateGrounded({
    claim: 'Second monetization move in two months, pricing rose to $19 [S1] after the API launch [S2].',
    basisSignals: basis,
  });
  assert(ok.grounded, `valid claim passes (failures: ${ok.failures.join('; ')})`);

  // 2. No citation fails.
  const noCite = validateGrounded({ claim: 'Acme is moving upmarket.', basisSignals: basis });
  assert(!noCite.grounded && noCite.failures.some((f) => f.includes('citation')), 'uncited claim fails');

  // 3. A marker that points past the end of the basis fails.
  const badRef = validateGrounded({ claim: 'Pricing rose [S9].', basisSignals: basis });
  assert(!badRef.grounded && badRef.failures.some((f) => f.includes('S9')), 'unknown marker fails');

  // 4. An invented number fails.
  const invented = validateGrounded({ claim: 'Pricing rose 40% to $27 [S1].', basisSignals: basis });
  assert(!invented.grounded, 'invented figures fail');

  // 5. An empty basis fails.
  const empty = validateGrounded({ claim: 'Anything [S1].', basisSignals: [] });
  assert(!empty.grounded, 'empty basis fails');

  // 6. Grouped citations "[S1, S2]" normalize and validate. In the first live run the
  //    model used this form for all 34 claims and every one was dropped.
  assert(normalizeCitations('rose to $19 [S1, S2].') === 'rose to $19 [S1][S2].', 'comma group normalizes');
  assert(normalizeCitations('rose [S1][S2].') === 'rose [S1][S2].', 'canonical form is a fixpoint');
  assert(normalizeCitations('list [1, 2] stays.') === 'list [1, 2] stays.', 'non-citation brackets untouched');
  const grouped = validateGrounded({
    claim: 'Pricing rose to $19 [S1, S2].',
    basisSignals: basis,
  });
  assert(grouped.grounded, `grouped-citation claim passes (failures: ${grouped.failures.join('; ')})`);

  // 7. The worked pair from the README. If either assertion flips, change the README
  //    in the same commit; do not relax the assertion.
  const pairBasis = [
    {
      id: 'p1', title: 'Entry tier raised from $29 to $49 per month',
      summary: 'Pricing page now lists $49 as the lowest paid plan.',
      signal_type: 'pricing_change', detected_at: '2026-07-14',
    },
    {
      id: 'p2', title: 'Starter plan removed from the pricing page',
      summary: 'The $29 Starter tier no longer appears.',
      signal_type: 'pricing_change', detected_at: '2026-07-28',
    },
  ];
  const pairShips = validateGrounded({
    claim:
      'Entry pricing moved from $29 to $49 in eight weeks, which is consistent with a deliberate move upmarket rather than a one-off test [S1][S2].',
    basisSignals: pairBasis,
  });
  assert(pairShips.grounded, `README "ships" example must pass (${pairShips.failures.join('; ')})`);

  const pairDropped = validateGrounded({
    claim:
      'Entry pricing moved from $29 to $49, and roughly 40% of their customers churned as a result [S1][S2].',
    basisSignals: pairBasis,
  });
  assert(
    !pairDropped.grounded && pairDropped.failures.some((f) => f.includes('40%')),
    'README "dropped" example must fail on the invented 40% figure',
  );

  // 8. Known limits, pinned so the README cannot drift from the code. The validator
  //    catches invented FIGURES, not invented reasoning.
  const prediction = validateGrounded({
    claim: 'Entry pricing moved from $29 to $49, and they will lose customers as a result [S1][S2].',
    basisSignals: pairBasis,
  });
  assert(prediction.grounded, 'a prediction with no new number passes: only figures are checked');

  const numberWord = validateGrounded({
    claim: 'Entry pricing moved from $29 to $49 and forty customers left [S1].',
    basisSignals: pairBasis,
  });
  assert(numberWord.grounded, 'a number written as a word is not checked: only digit tokens are');

  const wrongCitation = validateGrounded({
    claim: 'The Starter plan was removed [S1].',
    basisSignals: pairBasis,
  });
  assert(wrongCitation.grounded, 'a real marker on a sentence it does not support passes: support is not checked');

  // 9. A source item with no date does not put the word "undefined" into the basis.
  const undated = validateGrounded({
    claim: 'Pricing rose to $19 [S1].',
    basisSignals: [{ title: 'Acme raised prices to $19', summary: 'Pro tier changed.' }],
  });
  assert(undated.grounded, `a source item without a date still works (failures: ${undated.failures.join('; ')})`);

  console.log('grounding tests passed (9 groups)');
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
