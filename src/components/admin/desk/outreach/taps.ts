/** "12 people went to buy", "1 person went to buy", or "" when nobody has (the desk shows nothing rather than a zero). */
export function wentToBuy(n: number | null | undefined): string {
  if (!n || n < 1) return "";
  return `${n.toLocaleString("en-NG")} ${n === 1 ? "person" : "people"} went to buy`;
}
