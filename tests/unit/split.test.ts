import { describe, it, expect } from "vitest";
import { splitEqually } from "@/lib/split";

describe("splitEqually", () => {
  it("divides evenly when it divides evenly", () => {
    expect(splitEqually(9000, 3)).toEqual([3000, 3000, 3000]);
  });

  it("hands the leftover yen to the earliest members", () => {
    expect(splitEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqually(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqually(100, 6)).toEqual([17, 17, 17, 17, 16, 16]);
  });

  it("always sums back to the original amount", () => {
    for (let total = 0; total <= 2000; total += 7) {
      for (let n = 1; n <= 9; n++) {
        const shares = splitEqually(total, n);
        expect(shares.reduce((s, x) => s + x, 0)).toBe(total);
      }
    }
  });

  it("keeps every share a whole yen", () => {
    for (const [total, n] of [[10000, 3], [777, 5], [1, 4], [12345, 7]] as const) {
      for (const share of splitEqually(total, n)) {
        expect(Number.isInteger(share)).toBe(true);
      }
    }
  });

  it("never lets two members differ by more than one yen", () => {
    for (const [total, n] of [[10000, 3], [999, 7], [50, 9], [12345, 11]] as const) {
      const shares = splitEqually(total, n);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it("gives everyone zero for a zero total", () => {
    expect(splitEqually(0, 3)).toEqual([0, 0, 0]);
  });

  it("gives one person the whole amount", () => {
    expect(splitEqually(4500, 1)).toEqual([4500]);
  });

  it("rounds a fractional total to whole yen before splitting", () => {
    const shares = splitEqually(100.4, 2);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100);
  });

  it("returns nothing when there is nobody to split between", () => {
    expect(splitEqually(1000, 0)).toEqual([]);
  });
});
