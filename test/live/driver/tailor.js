const p = s.jobPanel;
await p.locator("button:visible", { hasText: "Generate" }).nth(1).click();
const t0 = Date.now();
for (let i = 0; i < 280; i++) { await sleep(1000); const t = await p.evaluate(() => document.body.innerText); if (/side by side|Open preview|changes?\b.*\d|error|failed|could not/i.test(t) && !/Tailoring|Rewriting/i.test(t)) break; }
const text = await p.evaluate(() => { const t = document.body.innerText; const i = t.indexOf("Tailored resume"); return t.slice(i, i + 2500); });
const buttons = await p.evaluate(() => [...document.querySelectorAll("button, a")].filter(e => e.offsetParent).map(b => b.textContent.trim()).filter(Boolean));
return { secs: Math.round((Date.now() - t0) / 1000), text, buttons };
