await s.panel?.close().catch(()=>{}); await s.applyPanel?.close().catch(()=>{}); s.applyPanel = null;
await s.cdp.send("Extensions.loadUnpacked", { path: "/Users/vijay/dev/projects/smartjob/dist" }); await sleep(1500);
await s.mgr.evaluate((id) => chrome.management.setEnabled(id, true), s.ext).catch(() => {}); await sleep(1000);
s.panel = await ctx.newPage(); await s.panel.goto("chrome-extension://" + s.ext + "/sidepanel.html");
const target = s.fp; await target.reload(); await sleep(5000);
return target.url();
