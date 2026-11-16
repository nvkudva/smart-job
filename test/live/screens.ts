// Screenshots of each panel tab against the fake LLM: `bun run build && OUT_DIR=/tmp bun test/live/screens.ts`.
import { defaultSettings, emptyProfile } from "../../src/storage.ts";
import * as fakeLlm from "../e2e/fakeLlm.ts";
import * as harness from "../e2e/harness.ts";

const outDir = process.env.OUT_DIR ?? "/tmp";
const llm = fakeLlm.start();
const h = await harness.launch();
await h.seed({
  settings: { ...defaultSettings, provider: { kind: "openai", baseUrl: llm.baseUrl, apiKey: "", model: "fake" } },
  resume: { text: "Ada Lovelace. TypeScript and Preact engineer.", fileName: "resume.txt", fileBase64: "", mimeType: "text/plain" },
  profile: { ...emptyProfile, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", skills: ["TypeScript", "Preact"] },
});
const page = await h.context.newPage();
await page.goto(`${h.baseUrl}/panel-job.html`);
const panel = await h.openPanel();
const tabId = await panel.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes("panel-job"))?.id);
await panel.setViewportSize({ width: 400, height: 900 });
await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html?tabId=${tabId}`);
await panel.waitForTimeout(4000);
for (const name of ["Job", "Apply", "Tracker", "Write", "Settings"]) {
  await panel.getByRole("tab", { name }).click();
  if (name === "Apply") {
    await panel.getByRole("button", { name: "Start applying" }).click();
    await panel.waitForTimeout(3000);
  }
  await panel.screenshot({ path: `${outDir}/panel-${name}.png`, fullPage: true });
}
await h.close();
llm.stop();
