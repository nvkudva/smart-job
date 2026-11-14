const p = s.panel;
await p.locator("button:visible", { hasText: /Finish/ }).click(); await sleep(2000);
const after = await p.evaluate(() => document.body.innerText.slice(0, 700));
const [tab] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), p.getByText(/Senior Engineering Manager/).first().click()]);
await sleep(7000);
const res = await tab.evaluate(() => ({ url: location.href, title: document.title, first: [...new Set([...document.querySelectorAll('[componentkey^="job-card-component-ref-"]')].map(e => e.innerText.split("\n").slice(0, 3).join(" | ")))].slice(0, 5) }));
await tab.close();
return { after, res };
