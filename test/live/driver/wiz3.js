const p = s.panel; const body = () => p.evaluate(() => document.body.innerText);
await p.getByLabel(/Import from LinkedIn/).check().catch(e => null);
await p.locator("button:visible", { hasText: /Build my profile/ }).click();
const t0 = Date.now(); let t = "";
for (let i = 0; i < 280; i++) { await sleep(1000); t = await body(); if (/3\. Review|Review your profile|failed|error/i.test(t) && !/Reading LinkedIn|Building|Extracting/i.test(t)) break; }
return { secs: Math.round((Date.now() - t0) / 1000), text: t.slice(0, 2500), inputs: await p.evaluate(() => [...document.querySelectorAll("input, select, textarea")].filter(e => e.offsetParent).map(e => (e.closest("label")?.querySelector("span")?.textContent || e.getAttribute("aria-label") || "?") + " = " + e.value)) };
