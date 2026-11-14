const p = s.panel; const body = () => p.evaluate(() => document.body.innerText);
await p.evaluate(() => chrome.storage.local.set({ setupComplete: false }));
await p.goto("chrome-extension://" + s.ext + "/sidepanel.html"); await sleep(2500);
for (const re of [/Save and continue/, /Continue without|Next|Skip this/]) { await p.locator("button:visible", { hasText: re }).first().click(); await sleep(1500); }
let t = await body(); if (/3\. Review/.test(t)) { await p.locator("button:visible", { hasText: /Save and continue/ }).click(); }
for (let i = 0; i < 120; i++) { await sleep(1000); t = await body(); if (/4\. Job searches/.test(t) && !/Suggesting|…/.test(t)) break; }
await sleep(1500); t = await body();
return t.slice(t.indexOf("4."), t.indexOf("Finish") + 6);
