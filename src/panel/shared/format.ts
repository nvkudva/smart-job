/** Amount in the viewer's locale (grouping, symbol position; INR always Indian grouping); the currency comes from the data, so a rupee figure stays rupees anywhere. */
export function money(amount: number, currency: string, locale?: string): string {
  const code = currency.trim().toUpperCase();
  // rupees read as 13,00,000 for everyone, whatever the browser locale
  locale ??= code === "INR" ? "en-IN" : undefined;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // not an ISO code (empty, "Rs"): plain grouped number with the label kept in front
    const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return code ? `${code} ${plain}` : plain;
  }
}

/** Indian digit grouping (12,00,000) when the profile country is India; otherwise the browser's own. */
export function localeForCountry(country: string): string | undefined {
  return /^\s*(india|in|bharat)\s*$/i.test(country) ? "en-IN" : undefined;
}

/** "1200000" → "1,200,000" while typing; text with letters or symbols ("12 LPA", "$90k") is left as typed. */
export function groupDigits(text: string, locale?: string): string {
  if (!/^[\d,]+$/.test(text)) return text;
  const digits = text.replace(/,/g, "");
  return digits ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(digits)) : "";
}

export function moneyRange(min: number | null, max: number | null, currency: string, locale?: string): string {
  if (min !== null && max !== null && min !== max) return `${money(min, currency, locale)} – ${money(max, currency, locale)}`;
  return money((min ?? max)!, currency, locale);
}
