const out = [];
for (const q of ["Senior Engineering Manager in Hyderabad", "Senior Engineering Manager jobs in Bangalore remote"]) {
  const t = await ctx.newPage(); await t.goto("https://www.linkedin.com/jobs/search-results/?keywords=" + encodeURIComponent(q)); await sleep(7000);
  const r = await t.evaluate(() => [...new Set([...document.querySelectorAll('[componentkey^="job-card-component-ref-"]')].map(e => e.innerText.split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 120)))].slice(0, 5));
  out.push({ q, url: t.url(), r }); await t.close(); await sleep(2000);
}
return out;
