/**
 * Split an amount into whole-yen shares that add up to exactly the total.
 *
 * A plain `total / count` leaves sub-yen shares (¥10,000 across 3 people gives
 * 3333.333…), and once each member's balance is rounded for display the column
 * no longer sums to zero. Handing the leftover yen to the first few members
 * keeps the arithmetic exact and the difference between members at most ¥1.
 */
export function splitEqually(total: number, count: number): number[] {
  if (count <= 0) return [];
  const whole = Math.round(total);
  const base = Math.floor(whole / count);
  const remainder = whole - base * count;
  return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base));
}

/**
 * Bring the custom-split amounts in line with who is participating: keep what
 * the user already typed for people still in, seed newcomers with a rounded
 * equal share of the total (0 while the total isn't valid yet), and drop
 * anyone no longer selected.
 */
export function reconcileCustomAmounts(
  prev: ReadonlyMap<string, string>,
  participantIds: ReadonlySet<string>,
  total: number | null
): Map<string, string> {
  const equalShare =
    total !== null && participantIds.size > 0 ? Math.round(total / participantIds.size) : 0;
  const next = new Map<string, string>();
  for (const id of participantIds) {
    next.set(id, prev.get(id) ?? String(equalShare));
  }
  return next;
}
