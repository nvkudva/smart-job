// usage: s.target = url before posting
s.fp?.close().catch(()=>{});
s.fp = await ctx.newPage(); await s.fp.goto(s.target); await sleep(6000);
s.fillTab = await s.panel.evaluate(async (u) => (await chrome.tabs.query({})).find(t => t.url.startsWith(u.slice(0, 40)))?.id, s.fp.url());
return { url: s.fp.url(), tab: s.fillTab };
