// a passport's number as it is printed: the day and month it was issued, then its place in
// the order passports were issued. 0110001 is the first one, issued on 1 October
export function serialLabel(number: number, issuedAt: Date | string): string {
  const d = new Date(issuedAt);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}${month}${String(number).padStart(3, "0")}`;
}
