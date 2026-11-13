// drive the real panel UI: Apply tab -> Fill this page (AI off unless s.useAi)
const tab = s.fillTab ?? s.wdTab;
if (!s.applyPanel || s.applyPanelTab !== tab) { s.applyPanel?.close().catch(()=>{}); s.applyPanel = await ctx.newPage(); s.applyPanelTab = tab; await s.applyPanel.goto(`chrome-extension://${s.ext}/sidepanel.html?tabId=${tab}`); await sleep(2500); }
const ap = s.applyPanel;
await ap.getByRole("button", { name: "Apply", exact: true }).click().catch(() => ap.getByText("Apply", { exact: true }).first().click());
await sleep(800);
const ai = ap.getByLabel(/use ai/i); if (await ai.count()) { const on = await ai.isChecked(); if (on !== !!s.useAi) await ai.click(); }
await ap.getByRole("button", { name: /Fill this page/ }).click();
for (let i = 0; i < 240; i++) { await sleep(1000); if (!(await ap.getByRole("button", { name: /Filling/ }).count())) break; }
await sleep(500);
return await ap.evaluate(() => document.querySelector("main, body").innerText.slice(0, 4000));
