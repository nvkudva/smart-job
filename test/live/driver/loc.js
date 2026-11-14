const out = [];
for (const u of ["https://www.linkedin.com/jobs/search-results/?keywords=Senior%20Engineering%20Manager&location=Bangalore", "https://www.linkedin.com/jobs/search/?keywords=Senior%20Engineering%20Manager&location=Hyderabad"]) {
  const t = await ctx.newPage(); await t.goto(u); await sleep(7000);
  const r = await t.evaluate(() => ({ url: location.href, locs: [...new Set([...document.querySelectorAll('[componentkey^="job-card-component-ref-"]')].map(e => (e.innerText.split("\n").find(l => /India|Remote|,/.test(l)) || "").slice(0, 50)))].slice(0, 6), box: [...document.querySelectorAll("input")].map(i => i.value).filter(Boolean).slice(0, 3) }));
  out.push(r); await t.close(); await sleep(2000);
}
return out;
