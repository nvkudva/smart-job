import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const distDir = resolve(import.meta.dir, "../../dist");
const fixturesDir = resolve(import.meta.dir, "../fixtures");

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  /** http://localhost:<port> serving test/fixtures */
  baseUrl: string;
  /** opens chrome-extension://<id>/sidepanel.html as a normal tab (same APIs as the side panel) */
  openPanel(): Promise<Page>;
  /** seed chrome.storage.local via the service worker */
  seed(values: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export async function launch(options: { headless?: boolean; deviceScaleFactor?: number } = {}): Promise<Harness> {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(fixturesDir, path === "/" ? "index.html" : path));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
  const userDataDir = await mkdtemp(join(tmpdir(), "smartjob-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: options.headless ?? true,
    deviceScaleFactor: options.deviceScaleFactor,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  return {
    context,
    extensionId,
    baseUrl: `http://localhost:${server.port}`,
    async openPanel() {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      return page;
    },
    async seed(values) {
      await worker.evaluate((items) => chrome.storage.local.set(items), values);
    },
    async close() {
      await context.close();
      server.stop(true);
    },
  };
}

/** Run from a panel page: send a ContentRequest to every frame of the tab whose URL contains urlPart. */
export async function sendToTab(panel: Page, urlPart: string, request: unknown): Promise<unknown[]> {
  return panel.evaluate(
    async ({ urlPart, request }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.includes(urlPart));
      if (!tab?.id) throw new Error(`no tab for ${urlPart}`);
      const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab.id })) ?? [];
      const responses = [];
      for (const frame of frames) {
        responses.push(await chrome.tabs.sendMessage(tab.id, request, { frameId: frame.frameId }).catch(() => undefined));
      }
      return responses;
    },
    { urlPart, request },
  );
}
