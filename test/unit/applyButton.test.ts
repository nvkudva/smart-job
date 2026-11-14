import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from "bun:test";
import * as applyButton from "../../src/content/applyButton.ts";

function page(body: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><body>${body}</body>`, "text/html");
}

test("an Apply link is returned for the panel to open", () => {
  const doc = page('<a href="https://boards.example.com/apply/1" target="_blank">Apply for this job</a>');
  expect(applyButton.click(doc)).toEqual({ result: "link", href: "https://boards.example.com/apply/1", label: "apply for this job" });
});

test("an Apply button is clicked in place", () => {
  const doc = page('<button id="go">Easy Apply</button>');
  let clicks = 0;
  doc.getElementById("go")!.addEventListener("click", () => clicks++);
  expect(applyButton.click(doc)).toMatchObject({ result: "clicked" });
  expect(clicks).toBe(1);
});

test("submit, applied and save controls are never taken for Apply", () => {
  const doc = page('<button>Submit application</button><button>Applied</button><button>Save job</button><form><input name="name"><button type="submit">Apply</button></form>');
  expect(applyButton.click(doc)).toEqual({ result: "none" });
});

test("hidden Apply controls are skipped", () => {
  const doc = page('<div hidden><button>Apply now</button></div><a href="mailto:jobs@example.com">Apply</a>');
  expect(applyButton.click(doc)).toEqual({ result: "none" });
});

test("LinkedIn's Easy Apply button is found by its aria-label or its text", () => {
  const doc = page('<button aria-label="Easy Apply to Engineering Manager at Acme"><svg></svg><span>Easy Apply</span></button>');
  expect(applyButton.click(doc)).toMatchObject({ result: "clicked", label: "easy apply" });
  const labelOnly = page('<a role="button" aria-label="Easy Apply to Engineering Manager at Acme"><svg></svg></a>');
  expect(applyButton.click(labelOnly)).toMatchObject({ result: "clicked" });
});
