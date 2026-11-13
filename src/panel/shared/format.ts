/** Amount in the viewer's locale (grouping, symbol position); the currency comes from the data, so a rupee figure stays rupees anywhere. */
export function money(amount: number, currency: string, locale?: string): string {
  const code = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // not an ISO code (empty, "Rs"): plain grouped number with the label kept in front
    const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return code ? `${code} ${plain}` : plain;
  }
}

export function moneyRange(min: number | null, max: number | null, currency: string, locale?: string): string {
  if (min !== null && max !== null && min !== max) return `${money(min, currency, locale)} – ${money(max, currency, locale)}`;
  return money((min ?? max)!, currency, locale);
}
