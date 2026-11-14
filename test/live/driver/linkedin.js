const p = s.panel;
await p.goto("chrome-extension://" + s.ext + "/sidepanel.html"); await sleep(2000);
const head = await p.evaluate(() => document.body.innerText.slice(0, 200));
await p.getByText("Settings", { exact: true }).first().click(); await sleep(800);
await p.getByRole("button", { name: /from LinkedIn/ }).click();
const t0 = Date.now();
for (let i = 0; i < 240; i++) { await sleep(1000); const busy = await p.getByRole("button", { name: /Importing|Reading|…/ }).count(); if (!busy && i > 3) break; }
const after = await p.evaluate(async () => { const st = await chrome.storage.local.get(["profile", "linkedinImportedAt"]); return { at: st.linkedinImportedAt, summary: st.profile.linkedinSummary, edu: st.profile.education, skills: st.profile.skills.length, exp: st.profile.experience.map(e => `${e.title} @ ${e.company} ${e.start}-${e.end}`) }; });
const msg = await p.evaluate(() => [...document.querySelectorAll(".error, .field-error, .ok-text, .muted")].map(e => e.textContent).filter(t => /linkedin|import|log/i.test(t)).slice(0, 5));
return { head, secs: Math.round((Date.now() - t0) / 1000), msg, ...after };
