// CONTRACT (owned by supervisor): router only. Job extraction lives in job.ts, forms in form/.
import type { ContentRequest } from "../messages.ts";
import * as applyButton from "./applyButton.ts";
import * as job from "./job.ts";
import * as form from "./form/index.ts";

function listen(): void {
  chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
    respond(request).then(sendResponse, (error) => {
      console.warn("[SmartJob]", error);
      sendResponse(undefined);
    });
    return true;
  });
}

async function respond(request: ContentRequest): Promise<unknown> {
  switch (request.type) {
    case "ping":
      return { ok: true, url: location.href, isTop: window === window.top };
    case "extractJob":
      return job.extract();
    case "scanFields":
      return form.scan();
    case "fillFields":
      return form.fill(request.fills, request.resumeFile);
    case "clickApply":
      return applyButton.click();
    case "clearHighlights":
      form.clearHighlights();
      return { ok: true };
    case "focusField":
      return { ok: form.focus(request.id) };
    case "storeCredential":
      return { ok: await storeCredential(request.username, request.password) };
  }
}

/** Offers the login to Chrome's password manager (Google Password Manager when signed in); Chrome decides whether to show its save prompt. */
async function storeCredential(username: string, password: string): Promise<boolean> {
  // Chrome-only API that the DOM typings do not include
  const PasswordCredential = (globalThis as { PasswordCredential?: new (data: { id: string; password: string; name: string }) => Credential }).PasswordCredential;
  if (!username || !password || !PasswordCredential) return false;
  try {
    await navigator.credentials.store(new PasswordCredential({ id: username, password, name: username }));
    return true;
  } catch {
    return false;
  }
}

// the panel injects this script into tabs that have none, which can race Chrome's own injection; a second copy would double every listener
const marker = globalThis as { __smartjob?: boolean };
if (!marker.__smartjob) {
  marker.__smartjob = true;
  listen();
  form.watchForChanges();
  job.watchForChanges();
}
