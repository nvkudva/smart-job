import * as plainText from "./plainText.ts";

/** Description from the schema.org JobPosting block of a job page; "" when the page has none. */
export function description(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const data = JSON.parse(script.textContent ?? "null") as { "@type"?: string; description?: string } | null;
    if (data?.["@type"] !== "JobPosting" || !data.description) continue;
    return plainText.block(new DOMParser().parseFromString(data.description, "text/html").body);
  }
  return "";
}
