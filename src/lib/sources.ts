/**
 * How events are ranked against each other.
 *
 * Pure, and separate from the screen, because the choice encoded here is the
 * substance of the Sources screen rather than a detail of its layout — and
 * because a comparator that silently sorts the wrong way is the kind of bug
 * that looks like a plausible answer forever.
 */

/** The fields ranking reads. Both v_source_roi and v_source_cohort supply them. */
export type RankableSource = {
  source_id: string;
  new_contacts: number;
  active_or_better: number;
  cost_total_cents: number | null;
  cost_per_new_contact_cents: number | null;
  cost_per_active_or_better_cents: number | null;
};

/**
 * Ascending cost per Active-or-better, with "no ratio yet" last.
 *
 * Cost per *contact* is the number most people reach for and is the wrong one
 * to sort on: it is a leading indicator, and it is trivially flattered by
 * collecting business cards. An event where the operator met forty people and
 * stayed in touch with none of them would top that ranking while having
 * produced nothing. The full ladder is still computed and displayed — this
 * decides only what floats to the top.
 *
 * Null means either no cost recorded or nobody has reached Active. Neither is a
 * good score, so they sort last; putting them first would head a list of
 * "cheapest per relationship" with every event that produced no relationships.
 * Among those, more new contacts ranks higher — it is the only signal left.
 */
export function byCostPerActiveOrBetter(a: RankableSource, b: RankableSource): number {
  const left = a.cost_per_active_or_better_cents;
  const right = b.cost_per_active_or_better_cents;

  if (left === null && right === null) return b.new_contacts - a.new_contacts;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/** The ranking the screen deliberately does *not* use. Kept for the test that shows why. */
export function byCostPerNewContact(a: RankableSource, b: RankableSource): number {
  const left = a.cost_per_new_contact_cents;
  const right = b.cost_per_new_contact_cents;

  if (left === null && right === null) return b.new_contacts - a.new_contacts;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

export function rankEvents<T extends RankableSource>(rows: readonly T[]): T[] {
  return [...rows].sort(byCostPerActiveOrBetter);
}
