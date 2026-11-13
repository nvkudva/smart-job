await sleep(1500);
s.ext = "epjmdfipfljfdjhdniimapminjigngak";
s.cdp = await ctx.browser().newBrowserCDPSession();
s.mgr = await ctx.newPage(); await s.mgr.goto("chrome://extensions/");
s.panel = await ctx.newPage(); await s.panel.goto("chrome-extension://" + s.ext + "/sidepanel.html");
const st = await s.panel.evaluate(() => chrome.storage.local.get(["settings"]));
return { acct: st.settings.account?.email, sw: ctx.serviceWorkers().length };
