/** PKR amounts are whole rupees — round to nearest integer. */
export function money(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

export function formatPkr(amount: number): string {
  const n = money(amount);
  return `Rs ${n.toLocaleString("en-PK")}`;
}
