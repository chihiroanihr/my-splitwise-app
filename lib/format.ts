export function yen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}
