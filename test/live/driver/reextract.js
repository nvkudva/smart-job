const p = s.panel; await p.goto("chrome-extension://" + s.ext + "/sidepanel.html"); await sleep(1500);
await p.getByText("Settings", { exact: true }).first().click(); await sleep(800);
await p.getByRole("button", { name: /Extract profile/ }).click();
for (let i = 0; i < 200; i++) { await sleep(1000); if (/Profile updated|error|failed/i.test(await p.evaluate(() => document.body.innerText))) break; }
const pr = await p.evaluate(async () => (await chrome.storage.local.get("profile")).profile);
return [pr.currentTitle, pr.currentCompany, pr.linkedinSummary.length, pr.education.length];
