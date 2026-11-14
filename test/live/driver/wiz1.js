const p = s.panel;
await p.evaluate(() => chrome.storage.local.set({ setupComplete: false }));
await p.goto("chrome-extension://" + s.ext + "/sidepanel.html"); await sleep(2500);
return { text: await p.evaluate(() => document.body.innerText.slice(0, 1500)), buttons: await p.evaluate(() => [...document.querySelectorAll("button, input, select")].filter(e => e.offsetParent).map(b => b.tagName + ":" + (b.textContent.trim() || b.getAttribute("aria-label") || b.type || "") + (b.list ? ` list=${b.list.options.length}` : "")).slice(0, 30)) };
