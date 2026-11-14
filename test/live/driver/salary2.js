// usage: s.target = job URL; refreshes salary and returns the salary section text
s.jp?.close().catch(()=>{});
s.jp = await ctx.newPage(); await s.jp.goto(s.target); await sleep(6000);
s.jobTab = await s.panel.evaluate(async (u) => (await chrome.tabs.query({})).find(t => t.url.startsWith(u.slice(0, 45)))?.id, s.jp.url());
s.jobPanel?.close().catch(()=>{}); const p = s.jobPanel = await ctx.newPage(); await p.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${s.jobTab}`);
await sleep(4000);
await p.locator("button:visible", { hasText: "Refresh" }).first().click().catch(() => {});
for (let i = 0; i < 200; i++) { await sleep(1000); const t = await p.evaluate(() => document.body.innerText); if (!/Looking up|Analyzing/.test(t) && i > 5) break; }
const t = await p.evaluate(() => document.body.innerText);
await p.screenshot({ path: "/private/tmp/claude-501/-Users-vijay-dev-projects-smartjob/06aa5fdf-9b5a-42fc-aab6-a9514a7b889d/scratchpad/salary-panel.png", fullPage: true });
const at = t.search(/\nSalary\n/); return at < 0 ? t.slice(0, 1500) : t.slice(at);
