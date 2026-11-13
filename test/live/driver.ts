// Long-lived real-Chrome driver. POST /run with JS body: async function body receiving {ctx, page, panel, ext, sleep}.
import { chromium, type Page } from "playwright";
const userDataDir = `${process.env.HOME}/.smartjob-test-chrome`;
const dist = "/Users/vijay/dev/projects/smartjob/dist";
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chrome",
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ["--use-mock-keychain", "--disable-extensions", "--password-store=basic", "--enable-automation"],
  args: ["--enable-unsafe-extension-debugging"],
});
const loaded = await (await ctx.browser()!.newBrowserCDPSession()).send("Extensions.loadUnpacked" as any, { path: dist });
console.log("ext", JSON.stringify(loaded));
const state: any = { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()), panel: null as Page | null, ext: "" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
Bun.serve({
  port: 9555,
  idleTimeout: 255,
  async fetch(req) {
    const code = await req.text();
    try {
      const fn = new Function("s", "sleep", `return (async () => { const {ctx}=s; let page=s.page; ${code} })()`);
      const out = await fn(state, sleep);
      return new Response(typeof out === "string" ? out : JSON.stringify(out, null, 1));
    } catch (e: any) {
      return new Response("ERR " + (e?.stack ?? e), { status: 500 });
    }
  },
});
console.log("driver ready");
