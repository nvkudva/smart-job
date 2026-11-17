import * as plainText from "./plainText.ts";

function parseBlock(text: string): { "@type"?: string | string[]; description?: string } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Description from the schema.org JobPosting block of a job page; "" when the page has none. */
export function description(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const data = parseBlock(script.textContent ?? "");
    if (!data?.description || ![data["@type"]].flat().includes("JobPosting")) continue;
    return plainText.block(new DOMParser().parseFromString(data.description, "text/html").body);
  }
  return "";
}
