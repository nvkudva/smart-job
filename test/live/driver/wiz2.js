const p = s.panel; const log = [];
const vis = (re) => p.locator("button:visible", { hasText: re }).first();
const body = () => p.evaluate(() => document.body.innerText);
await vis(/Test connection/).click(); await sleep(2000); log.push((await body()).match(/Connected[^\n]*/)?.[0]);
await vis(/Save and continue/).click(); await sleep(1500);
log.push("STEP2: " + (await body()).slice(0, 900));
return log;
