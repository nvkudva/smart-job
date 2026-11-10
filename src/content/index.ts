// CONTRACT (owned by supervisor): router only. Job extraction lives in job.ts, forms in form/.
import type { ContentRequest } from "../messages.ts";
import * as job from "./job.ts";
import * as form from "./form/index.ts";

chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
  respond(request).then(sendResponse, (error) => {
    console.warn("[SmartJob]", error);
    sendResponse(undefined);
  });
  return true;
});

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
    case "clearHighlights":
      form.clearHighlights();
      return { ok: true };
    case "focusField":
      return { ok: form.focus(request.id) };
  }
}

form.watchForChanges();
job.watchForChanges();
