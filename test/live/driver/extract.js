const p = s.panel;
await p.locator('input[type=file]').first().setInputFiles("/Users/vijay/.t3/userdata/attachments/2d727057-fac4-45fd-bfbf-d335d1824fb9-c4c73ffe-51a3-4d72-b3dc-0326881b0647-pdf.pdf"); await sleep(3000);
await p.getByRole("button", { name: "Save resume" }).click(); await sleep(800);
await p.getByRole("button", { name: /Extract profile/ }).click();
const t0 = Date.now();
for (let i = 0; i < 280; i++) { await sleep(1000); const t = await p.evaluate(() => document.body.innerText); if (/Profile updated|did not return|error|failed/i.test(t)) break; }
const pr = await p.evaluate(async () => (await chrome.storage.local.get("profile")).profile);
const err = await p.evaluate(() => [...document.querySelectorAll(".error, [role=alert]")].map(e => e.textContent).join(" | "));
return { secs: Math.round((Date.now() - t0) / 1000), err, name: [pr.firstName, pr.lastName], city: [pr.city, pr.state, pr.country], links: [pr.linkedin, pr.github, pr.portfolio, pr.website], current: [pr.currentTitle, pr.currentCompany], years: pr.yearsExperience, edu: pr.education.map(e => `${e.degree} | ${e.field} | ${e.school} | ${e.start}-${e.end}`), exp: pr.experience.map(e => `${e.title} @ ${e.company} | ${e.location} | ${e.start}-${e.end} cur=${e.current} | ${e.description.length}ch`) };
