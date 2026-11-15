import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import * as mapping from "../../src/fill/mapping.ts";
import { defaultSettings, emptyProfile } from "../../src/storage.ts";
import type { FieldDescriptor, FieldFill, FillResult, Profile, Resume } from "../../src/types.ts";
import * as harness from "./harness.ts";

const profile: Profile = {
  ...emptyProfile,
  firstName: "Priya",
  lastName: "Raman",
  email: "priya@example.com",
  phone: "+1 415 555 0100",
  phoneCountryCode: "+1",
  address: "12 Market St",
  city: "San Francisco",
  state: "California",
  postalCode: "94105",
  country: "United States",
  linkedin: "https://linkedin.com/in/priya",
  github: "https://github.com/priya",
  portfolio: "https://priya.dev",
  website: "https://priya.example.com",
  currentTitle: "Senior Engineer",
  currentCompany: "Acme",
  yearsExperience: 6,
  experience: [
    { title: "Senior Engineer", company: "Acme", location: "Remote", start: "2020-03", end: "", current: true, description: "" },
    { title: "Engineer", company: "Globex", location: "NYC", start: "2016-06", end: "2020-02", current: false, description: "" },
  ],
  education: [{ school: "MIT", degree: "Bachelor of Science", field: "Computer Science", start: "2012-09", end: "2016-05", gpa: "3.8" }],
  workAuthorized: "yes",
  requiresSponsorship: "no",
  willingToRelocate: "yes",
  salaryExpectation: "$180,000",
};

const resume: Resume = {
  text: "Priya Raman resume",
  fileName: "resume.pdf",
  fileBase64: Buffer.from("%PDF-1.4 fake").toString("base64"),
  mimeType: "application/pdf",
};

let h: harness.Harness;
beforeAll(async () => {
  h = await harness.launch();
  await h.seed({
    profile,
    resume,
    // unreachable endpoint so any AI call fails fast
    settings: { ...defaultSettings, provider: { kind: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "x" } },
  });
});
afterAll(async () => {
  await h?.close();
});

async function listFrames(panel: Page, urlPart: string): Promise<{ tabId: number; frameIds: number[] }> {
  return panel.evaluate(async (urlPart) => {
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url?.includes(urlPart));
    if (!tab?.id) throw new Error(`no tab for ${urlPart}`);
    const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab.id })) ?? [];
    return { tabId: tab.id, frameIds: frames.map((frame) => frame.frameId) };
  }, urlPart);
}

function sendToFrame(panel: Page, tabId: number, frameId: number, request: unknown): Promise<unknown> {
  return panel.evaluate(({ tabId, frameId, request }) => chrome.tabs.sendMessage(tabId, request, { frameId }).catch(() => undefined), { tabId, frameId, request });
}

/** Panel-side session equivalent: scan each frame, map in this process, fill each frame. */
async function autofill(panel: Page, urlPart: string) {
  const { tabId, frameIds } = await listFrames(panel, urlPart);
  const fields: FieldDescriptor[] = [];
  const fills: FieldFill[] = [];
  const results: FillResult[] = [];
  for (const frameId of frameIds) {
    const scanned = ((await sendToFrame(panel, tabId, frameId, { type: "scanFields" })) as FieldDescriptor[] | undefined) ?? [];
    const frameFields = scanned.map((field) => ({ ...field, frameId }));
    const frameFills = mapping.map(frameFields, profile, {}, resume);
    const resumeFile = { name: resume.fileName, base64: resume.fileBase64, mimeType: resume.mimeType };
    const response = (await sendToFrame(panel, tabId, frameId, { type: "fillFields", fills: frameFills, resumeFile })) as FillResult[] | undefined;
    const unknown = frameFields.filter((field) => field.required && !frameFills.some((fill) => fill.id === field.id)).map((field) => ({ id: field.id, isRequired: true }));
    await sendToFrame(panel, tabId, frameId, { type: "markUnknown", unknown, shouldScroll: false });
    fields.push(...frameFields);
    fills.push(...frameFills);
    results.push(...(response ?? []));
  }
  return { fields, fills, results };
}

async function openFixture(path: string) {
  const page = await h.context.newPage();
  await page.goto(`${h.baseUrl}${path}`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  const panel = await h.openPanel();
  return { page, panel };
}

function missing(state: Record<string, unknown>, expected: Record<string, unknown>) {
  return Object.entries(expected)
    .filter(([key, value]) => state[key] !== value)
    .map(([key, value]) => `${key}: wanted ${JSON.stringify(value)} got ${JSON.stringify(state[key])}`);
}

const readState = (target: Page | import("playwright").Frame) => target.evaluate(() => (window as any).__formState as Record<string, unknown>);

describe("autofill fixtures", () => {
  test("Workday-like: inputs, custom dropdowns, radios, split dates, hidden file input", async () => {
    const { page, panel } = await openFixture("/workday-apply.html");
    const { fields, results } = await autofill(panel, "/workday-apply.html");
    const state = await readState(page);
    const expected = {
      source: "Job Board",
      sourceMulti: "LinkedIn",
      "legalNameSection_firstName": "Priya",
      "legalNameSection_lastName": "Raman",
      "addressSection_addressLine1": "12 Market St",
      "addressSection_city": "San Francisco",
      "addressSection_countryRegion": "California",
      "addressSection_postalCode": "94105",
      email: "priya@example.com",
      "phone-device-type": "Mobile",
      "country-phone-code": "United States of America (+1)",
      "phone-number": "4155550100",
      "jobTitle-1": "Senior Engineer",
      "company-1": "Acme",
      "currentlyWorkHere-1": true,
      "dateSectionMonth-input-1": "03",
      "dateSectionYear-input-1": "2020",
      "jobTitle-2": "Engineer",
      "company-2": "Globex",
      "startDate-2": "06/2016",
      "endDate-2": "02/2020",
      school: "MIT",
      degree: "Bachelor's Degree",
      fieldOfStudy: "Computer Science",
      "file-upload-input-ref": "resume.pdf",
      linkedinQuestion: profile.linkedin,
      authorized: "Yes",
      sponsorship: "No",
      relocate: "Yes",
      gender: "I do not wish to answer",
      veteran: "I do not wish to answer",
    };
    const misses = missing(state, expected);
    expect(misses).toEqual([]);
    expect(state["legalNameSection_middleName"] ?? "").toBe("");
    expect(state["phone-extension"] ?? "").toBe("");
    expect(fields.find((field) => field.automationId === "dateSectionMonth-input-1")).toMatchObject({ kind: "date", label: "From", section: "Work Experience 1" });
    expect(fields.some((field) => field.kind === "text" && field.label.includes("Search"))).toBe(false);
    expect(results.filter((result) => !result.ok).map((result) => result.error)).toEqual([]);
    // required checkbox left for the user, outlined amber
    expect(await page.locator('[data-automation-id="acceptTerms"]').evaluate((el) => el.closest("label")!.getAttribute("data-sj-highlight") ?? el.getAttribute("data-sj-highlight"))).toBe("review");
    expect(await page.locator("#resume").evaluate((el: HTMLInputElement) => el.files!.length)).toBe(1);
  }, 60000);

  test("a plain .value assignment is rejected by the controlled form (sanity check of the fixture)", async () => {
    const page = await h.context.newPage();
    await page.goto(`${h.baseUrl}/workday-apply.html`);
    await page.evaluate(() => {
      (document.getElementById("firstName") as HTMLInputElement).value = "Plain";
      document.getElementById("lastName")!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(await page.locator("#firstName").inputValue()).toBe("");
    expect((await readState(page))["legalNameSection_firstName"]).toBeUndefined();
  });

  test("Greenhouse-like: names, selects, file, EEO decline; free-text question flagged", async () => {
    const { page, panel } = await openFixture("/greenhouse-apply.html");
    const { results } = await autofill(panel, "/greenhouse-apply.html");
    const state = await readState(page);
    const expected = {
      "job_application[first_name]": "Priya",
      "job_application[last_name]": "Raman",
      "job_application[email]": "priya@example.com",
      "job_application[phone]": "+1 415 555 0100",
      "job_application[resume]": "resume.pdf",
      "job_application[answers_attributes][0][text_value]": profile.linkedin,
      "job_application[answers_attributes][1][text_value]": profile.website,
      "job_application[answers_attributes][2][text_value]": "Acme",
      "job_application[answers_attributes][3][boolean_value]": "1",
      "job_application[answers_attributes][4][boolean_value]": "0",
      "job_application[answers_attributes][5][value]": "2",
      "job_application[gender]": "3",
      "job_application[hispanic_ethnicity]": "3",
      "job_application[race]": "3",
      "job_application[veteran_status]": "3",
      "job_application[disability_status]": "3",
    };
    expect(missing(state, expected)).toEqual([]);
    expect(state["job_application[answers_attributes][6][text_value]"] ?? "").toBe("");
    expect(state["job_application[cover_letter]"]).toBeUndefined();
    expect(state["job_application[website_hp]"]).toBeUndefined();
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await page.locator("#q_why").getAttribute("data-sj-highlight")).toBe("review");
    expect(await page.locator("#first_name").getAttribute("data-sj-highlight")).toBe("profile");
  }, 60000);

  test("Lever-like: single name field, urls[], optional comments untouched", async () => {
    const { page, panel } = await openFixture("/lever-apply.html");
    await autofill(panel, "/lever-apply.html");
    const state = await readState(page);
    const expected = {
      name: "Priya Raman",
      email: "priya@example.com",
      phone: "+1 415 555 0100",
      location: "San Francisco, California",
      org: "Acme",
      "urls[LinkedIn]": profile.linkedin,
      "urls[GitHub]": profile.github,
      "urls[Portfolio]": profile.portfolio,
      resume: "resume.pdf",
      "cards[wa][field0]": "Yes",
      "cards[hh][field0]": "LinkedIn",
      "cards[uni][field0]": "Other (School Not Listed)", // MIT is not in the list; the question names the fallback
    };
    expect(missing(state, expected)).toEqual([]);
    expect(await page.locator('input[name="cards[ls][field0]"]:checked').count()).toBe(0); // no profile data for languages; one descriptor, not two
    expect(state["q"]).toBeUndefined();
    expect(state["comments"] ?? "").toBe("");
  }, 60000);

  test("iCIMS-like: form inside an iframe", async () => {
    const { page, panel } = await openFixture("/icims-apply.html");
    const { fields } = await autofill(panel, "/icims-apply.html");
    expect(new Set(fields.map((field) => field.frameId)).size).toBe(1);
    const frame = page.frames().find((candidate) => candidate.url().includes("icims-frame.html"))!;
    const state = await readState(frame);
    const expected = {
      "PersonProfileFields.FirstName": "Priya",
      "PersonProfileFields.LastName": "Raman",
      "PersonProfileFields.Email": "priya@example.com",
      "PersonProfileFields.Phone": "+1 415 555 0100",
      "PersonProfileFields.AddressStreet1": "12 Market St",
      "PersonProfileFields.AddressCity": "San Francisco",
      "PersonProfileFields.AddressState": "CA",
      "PersonProfileFields.AddressZip": "94105",
      "PersonProfileFields.AddressCountry": "US",
      resumeFile: "resume.pdf",
      auth: "Yes",
      sponsor: "No",
      salary: "$180,000",
      linkedin: profile.linkedin,
      gender: "Prefer not to answer",
    };
    expect(missing(state, expected)).toEqual([]);
    expect(await frame.locator("#resumeFile").evaluate((el: HTMLInputElement) => el.files!.length)).toBe(1);
  }, 60000);

  test("formChanged is broadcast when the form DOM changes (wizard step)", async () => {
    const { page, panel } = await openFixture("/lever-apply.html");
    await panel.evaluate(() => {
      (window as any).__changes = [];
      chrome.runtime.onMessage.addListener((message) => void (message?.type === "formChanged" && (window as any).__changes.push(message.url)));
    });
    await page.waitForTimeout(1000); // baseline signature
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.name = "extra";
      input.setAttribute("aria-label", "Extra step field");
      document.querySelector("form")!.append(input);
    });
    await page.waitForTimeout(1500);
    expect(await panel.evaluate(() => (window as any).__changes.length)).toBeGreaterThanOrEqual(1);
  }, 30000);
});
