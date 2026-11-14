s.jp?.close().catch(()=>{});
s.jp = await ctx.newPage(); await s.jp.goto(s.target); await sleep(6000);
s.jobTab = await s.panel.evaluate(async (u) => (await chrome.tabs.query({})).find(t => t.url.startsWith(u.slice(0, 45)))?.id, s.jp.url());
s.jobPanel?.close().catch(()=>{}); s.jobPanel = await ctx.newPage(); await s.jobPanel.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${s.jobTab}`);
for (let i = 0; i < 200; i++) { await sleep(1000); const t = await s.jobPanel.evaluate(() => document.body.innerText); if (!/Analyzing|Looking up/.test(t) && i > 5) break; }
return await s.jobPanel.evaluate(() => document.body.innerText.slice(0, 3500));
