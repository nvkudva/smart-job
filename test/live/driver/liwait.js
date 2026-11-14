const p = s.panel; const t0 = Date.now(); let status = "";
for (let i = 0; i < 270; i++) { await sleep(1000); status = await p.evaluate(() => document.body.innerText.match(/Reading LinkedIn[^\n]*|Summari[^\n]*|Last imported[^\n]*|not logged[^\n]*|[^\n]*failed[^\n]*/i)?.[0] ?? ""); if (/Last imported|not logged|failed|error/i.test(status)) break; }
const after = await p.evaluate(async () => { const st = await chrome.storage.local.get(["profile", "linkedinImportedAt"]); return { at: st.linkedinImportedAt, summary: st.profile.linkedinSummary, edu: st.profile.education, skills: st.profile.skills, headline: st.profile.headline }; });
return { status, secs: Math.round((Date.now() - t0) / 1000), ...after };
