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
