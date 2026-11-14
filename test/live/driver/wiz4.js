const p = s.panel; const body = () => p.evaluate(() => document.body.innerText);
await p.locator("button:visible", { hasText: /Save and continue/ }).click();
let t = ""; for (let i = 0; i < 120; i++) { await sleep(1000); t = await body(); if (!/Suggesting|Thinking|…/.test(t) && i > 2) break; }
const chips = await p.evaluate(() => [...document.querySelectorAll("input[type=checkbox], button[aria-pressed]")].filter(e => e.offsetParent || e.closest("label")?.offsetParent).map(e => (e.closest("label")?.innerText || e.textContent).trim() + (e.checked || e.getAttribute("aria-pressed") === "true" ? " [x]" : " [ ]")));
const loc = await p.evaluate(() => [...document.querySelectorAll("input")].filter(e => e.offsetParent && e.type === "text").map(e => e.value));
return { text: t.slice(t.indexOf("4."), t.indexOf("4.") + 900), chips, loc };
