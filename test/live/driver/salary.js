const p = s.jobPanel; const out = [];
for (const name of [/Levels\.fyi/, /Glassdoor/]) {
  await p.getByText(name).first().click(); await sleep(7000);
  const frame = p.frames().find(f => f !== p.mainFrame());
  const info = frame ? await frame.evaluate(() => ({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 250) })).catch(e => ({ err: e.message.slice(0, 80), url: frame.url() })) : "no frame";
  await p.screenshot({ path: `/private/tmp/claude-501/-Users-vijay-dev-projects-smartjob/06aa5fdf-9b5a-42fc-aab6-a9514a7b889d/scratchpad/sal-${out.length}.png` });
  out.push(info);
  await p.getByRole("button", { name: /Close/ }).first().click().catch(() => {}); await sleep(800);
}
return out;
