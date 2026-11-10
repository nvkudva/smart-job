// Extension-context checks the fixture e2e does not cover: PDF resume parsing, Anthropic request path, salary web search.
// `bun run build && OUT_DIR=/tmp bun test/live/checks.ts`
import * as harness from "../e2e/harness.ts";

const outDir = process.env.OUT_DIR ?? "/tmp";
const h = await harness.launch();

const doc = await h.context.newPage();
await doc.setContent("<h1>Priya Raman</h1><p>priya@example.com · Senior Software Engineer</p><p>Skills: TypeScript, React</p>");
const pdfPath = `${outDir}/resume-check.pdf`;
await doc.pdf({ path: pdfPath });

const panel = await h.openPanel();
await panel.getByRole("tab", { name: "Settings" }).click();
await panel.locator('input[type="file"][accept*="pdf"]').setInputFiles(pdfPath);
await panel.waitForTimeout(3000);
await panel.getByRole("button", { name: "Save resume" }).click();
await panel.waitForTimeout(1000);
const resume = await panel.evaluate(async () => (await chrome.storage.local.get("resume")).resume as { text: string; fileBase64: string } | undefined);
console.log("PDF resume:", resume ? `text=${JSON.stringify(resume.text.slice(0, 80))} base64=${resume.fileBase64.length}` : "NOT SAVED");

console.log("Anthropic:", await panel.evaluate(async () => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": "sk-ant-fake", "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
  });
  return `${response.status} ${(await response.text()).slice(0, 100)}`;
}));

const settings = await h.openPanel();
await settings.getByRole("tab", { name: "Settings" }).click();
await settings.waitForTimeout(1500);
await settings.locator("label.field select").first().selectOption("Anthropic");
await settings.getByLabel("API key", { exact: true }).fill("sk-ant-fake");
await settings.getByRole("button", { name: "Test connection" }).click();
await settings.waitForTimeout(5000);
console.log("Anthropic via SDK UI:", (await settings.locator("body").innerText()).match(/.*(401|auth|error|fail|Connected).*/i)?.[0]);

const bing = await panel.evaluate(async () => {
  const response = await fetch("https://www.bing.com/search?q=" + encodeURIComponent("Senior Software Engineer Stripe salary San Francisco") + "&setlang=en");
  const html = await response.text();
  return [...html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5).map((match) => match[1]!.replace(/<[^>]+>/g, ""));
});
console.log("Bing from extension:", bing);
await h.close();
