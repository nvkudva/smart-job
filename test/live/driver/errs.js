s.jobPanel?.close().catch(()=>{}); const p = s.jobPanel = await ctx.newPage(); const errs = [];
p.on("console", async m => { if (m.type() === "error") { const args = await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.stack : String(v)).catch(() => ""))); errs.push(args.join(" ").slice(0, 2500)); } });
await s.jp.reload(); await sleep(5000);
await p.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${s.jobTab}`); await sleep(8000);
return errs.slice(0, 2);
