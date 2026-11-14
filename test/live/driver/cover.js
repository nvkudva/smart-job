const p = s.jobPanel;
const gen = p.locator("button:visible", { hasText: "Generate" });
await gen.first().click();
for (let i = 0; i < 200; i++) { await sleep(1000); const busy = await p.locator("button:visible", { hasText: /Writing|Generating|…/ }).count(); if (!busy && i > 3) break; }
const letter = await p.evaluate(() => [...document.querySelectorAll("textarea, .letter, pre, .markdown, .prose")].filter(e => e.offsetParent).map(e => e.value || e.innerText).sort((a, b) => b.length - a.length)[0]);
return { words: letter?.split(/\s+/).length, letter };
