s.jp?.close().catch(()=>{}); s.jp = await ctx.newPage(); await s.jp.goto("https://www.linkedin.com/jobs/view/4484674454/"); await sleep(6000);
s.jobTab = await s.panel.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url.includes("4484674454"))?.id);
s.jobPanel?.close().catch(()=>{}); const p = s.jobPanel = await ctx.newPage(); await p.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${s.jobTab}`); await sleep(3000);
await p.getByText("Write", { exact: true }).first().click(); await sleep(1000);
await p.locator("button:visible", { hasText: /^(Generate|Regenerate)$/ }).nth(1).click();
for (let i = 0; i < 200; i++) { await sleep(1000); if (await p.locator("button:visible", { hasText: "Open side-by-side preview" }).count() && !/Tailoring|Rewriting/.test(await p.evaluate(() => document.body.innerText))) break; }
const st = await s.panel.evaluate(async () => (await chrome.storage.local.get("tailoredPreview")).tailoredPreview);
await Bun.write("/private/tmp/claude-501/-Users-vijay-dev-projects-smartjob/06aa5fdf-9b5a-42fc-aab6-a9514a7b889d/scratchpad/tailored2.pdf", Buffer.from(st.tailoredBase64, "base64"));
return st.changes.slice(0, 3).map(c => (c.after ?? c.newText ?? JSON.stringify(c)).slice(0, 60));
