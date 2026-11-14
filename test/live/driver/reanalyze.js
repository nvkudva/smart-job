await s.jp.reload(); await sleep(5000);
s.jobPanel?.close().catch(()=>{}); s.jobPanel = await ctx.newPage(); await s.jobPanel.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${s.jobTab}`); await sleep(3000);
await s.jobPanel.getByRole("button", { name: /Re-analyze/ }).click();
for (let i = 0; i < 200; i++) { await sleep(1000); const t = await s.jobPanel.evaluate(() => document.body.innerText); if (!/Analyzing/.test(t) && i > 3) break; }
const t = await s.jobPanel.evaluate(() => document.body.innerText);
return t.slice(t.indexOf("Match"), t.indexOf("NICE TO HAVE")) + "\n…\n" + t.slice(t.indexOf("MISSING SKILLS"), t.indexOf("Re-analyze"));
