const p = s.jobPanel;
const [prev] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), p.locator("button:visible", { hasText: "Open side-by-side preview" }).click()]);
s.prev = prev; await prev.setViewportSize({ width: 1500, height: 1000 }).catch(() => {}); await sleep(5000);
const info = await prev.evaluate(() => ({ url: location.href, canvases: [...document.querySelectorAll("canvas")].map(c => `${c.width}x${c.height}`), text: document.body.innerText.slice(0, 300), err: [...document.querySelectorAll(".error")].map(e => e.textContent) }));
await prev.screenshot({ path: "/private/tmp/claude-501/-Users-vijay-dev-projects-smartjob/06aa5fdf-9b5a-42fc-aab6-a9514a7b889d/scratchpad/preview.png" });
return info;
