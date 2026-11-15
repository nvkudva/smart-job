import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import * as form from "../../src/content/form/index.ts";
import type { FieldDescriptor } from "../../src/types.ts";

afterEach(() => {
  form.clearHighlights();
  document.body.innerHTML = "";
});

function scanHtml(html: string): FieldDescriptor[] {
  document.body.innerHTML = html;
  return form.scan();
}

describe("label resolution", () => {
  test("label[for], wrapping label, aria-labelledby, aria-label, placeholder, automation id, preceding text", () => {
    const fields = scanHtml(`
      <label for="a">Email *</label><input id="a" type="email" />
      <label>City <input name="city" /></label>
      <span id="lbl">Zip code</span><input aria-labelledby="lbl" name="zip" />
      <input aria-label="Phone number" name="phone" />
      <input placeholder="Your website" name="site" />
      <input data-automation-id="formField-legalNameSection_firstName" name="fn" />
      <div><p>Tell us more</p><div><textarea name="more"></textarea></div></div>
    `);
    expect(fields.map((field) => field.label)).toEqual(["Email", "City", "Zip code", "Phone number", "Your website", "first Name", "Tell us more"]);
    expect(fields[0]).toMatchObject({ kind: "email", required: true, frameId: 0 });
    expect(fields[5]?.automationId).toBe("formField-legalNameSection_firstName");
    expect(fields[6]?.kind).toBe("textarea");
  });

  test("skips hidden, disabled, submit and header search fields", () => {
    const fields = scanHtml(`
      <header><input type="search" aria-label="Search jobs" /></header>
      <input type="hidden" name="csrf" />
      <input type="text" name="off" disabled />
      <input type="text" name="gone" style="display:none" />
      <div hidden><input name="inside_hidden" /></div>
      <input type="submit" value="Go" />
      <input type="text" name="keep" aria-label="Keep me" />
    `);
    expect(fields.map((field) => field.name)).toEqual(["keep"]);
  });

  test("scans password fields with the value masked, and skips anti-bot honeypots", () => {
    const fields = scanHtml(`
      <label for="pw">Password</label><input id="pw" type="password" name="password" value="hunter2" />
      <label for="hp">Enter website. This input is for robots only, do not enter if you're human.</label><input id="hp" name="website" data-automation-id="beecatcher" />
    `);
    expect(fields.map((field) => [field.kind, field.name, field.currentValue])).toEqual([["password", "password", "********"]]);
  });

  test("data-sj-id stays stable across rescans", () => {
    document.body.innerHTML = `<input name="a" aria-label="A" /><input name="b" aria-label="B" />`;
    const first = form.scan().map((field) => field.id);
    expect(form.scan().map((field) => field.id)).toEqual(first);
    expect(new Set(first).size).toBe(2);
  });
});

describe("groups, options, sections", () => {
  test("radios with one name become a single descriptor with the legend as label", () => {
    const fields = scanHtml(`
      <fieldset><legend>Are you authorized to work? *</legend>
        <label><input type="radio" name="auth" value="1" /> Yes</label>
        <input type="radio" id="n" name="auth" value="0" /><label for="n">No</label>
      </fieldset>`);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: "radio", label: "Are you authorized to work?", options: ["Yes", "No"], currentValue: "" });
  });

  test("select options skip the placeholder; selected placeholder reads as empty", () => {
    const [select] = scanHtml(`<label for="s">State</label><select id="s"><option value="">Select...</option><option>California</option><option>Texas</option></select>`);
    expect(select).toMatchObject({ kind: "select", options: ["California", "Texas"], currentValue: "" });
  });

  test("combobox buttons and file inputs with hidden element", () => {
    const fields = scanHtml(`
      <label id="l">Country</label><button aria-haspopup="listbox" aria-labelledby="l">Select One</button>
      <label for="f">Resume</label><input type="file" id="f" style="display:none" />`);
    expect(fields.map((field) => field.kind)).toEqual(["combobox", "file"]);
    expect(fields[0]).toMatchObject({ label: "Country", options: [], currentValue: "" });
  });

  test("section comes from the nearest heading so repeated blocks are distinguishable", () => {
    const fields = scanHtml(`
      <div><h4>Work Experience 1</h4><label>Job Title <input name="t1" /></label></div>
      <div><h4>Work Experience 2</h4><label>Job Title <input name="t2" /></label></div>`);
    expect(fields.map((field) => field.section)).toEqual(["Work Experience 1", "Work Experience 2"]);
  });

  test("date-like inputs are kind date", () => {
    const fields = scanHtml(`<input type="date" aria-label="a" /><input placeholder="MM/YYYY" aria-label="b" />`);
    expect(fields.map((field) => field.kind)).toEqual(["date", "date"]);
  });
});

describe("fill", () => {
  test("native setter + events reach a controlled-input listener", async () => {
    document.body.innerHTML = `<label for="x">First</label><input id="x" name="x" /><textarea id="t" aria-label="Notes"></textarea>`;
    const seen: string[] = [];
    document.addEventListener("input", (event) => seen.push((event.target as HTMLInputElement).value));
    const events: string[] = [];
    document.getElementById("x")!.addEventListener("change", () => events.push("change"));
    document.getElementById("x")!.addEventListener("blur", () => events.push("blur"));
    const [first, notes] = form.scan();
    const results = await form.fill([
      { id: first!.id, frameId: 0, value: "Priya", source: "profile" },
      { id: notes!.id, frameId: 0, value: "Hello", source: "ai" },
    ]);
    expect(seen).toEqual(["Priya", "Hello"]);
    expect(events).toContain("change");
    expect(events).toContain("blur");
    expect(results.map((result) => [result.ok, result.finalValue])).toEqual([[true, "Priya"], [true, "Hello"]]);
  });

  test("select, radio and checkbox are matched by option text", async () => {
    document.body.innerHTML = `
      <label for="s">Country</label><select id="s"><option value="">Select</option><option value="CA">Canada</option><option value="US">United States of America</option></select>
      <fieldset><legend>Sponsorship</legend><label><input type="radio" name="sp" value="1" /> Yes</label><label><input type="radio" name="sp" value="0" /> No</label></fieldset>
      <label><input type="checkbox" name="cur" /> I currently work here</label>`;
    const [select, radio, checkbox] = form.scan();
    const results = await form.fill([
      { id: select!.id, frameId: 0, value: "United States", source: "profile" },
      { id: radio!.id, frameId: 0, value: "No", source: "profile" },
      { id: checkbox!.id, frameId: 0, value: "true", source: "profile" },
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("US");
    expect((document.querySelector('input[value="0"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector("[name=cur]") as HTMLInputElement).checked).toBe(true);
  });

  test("unmatched select option and missing field report failure", async () => {
    document.body.innerHTML = `<label for="s">Pick</label><select id="s"><option>A</option><option>B</option></select>`;
    const [select] = form.scan();
    const results = await form.fill([
      { id: select!.id, frameId: 0, value: "zzz", source: "profile" },
      { id: "sj-missing", frameId: 0, value: "x", source: "profile" },
    ]);
    expect(results.map((result) => result.ok)).toEqual([false, false]);
  });

  test("dates are formatted from the input type / placeholder", async () => {
    document.body.innerHTML = `<input type="date" aria-label="d" /><input placeholder="MM/YYYY" aria-label="m" />`;
    const [date, text] = form.scan();
    await form.fill([
      { id: date!.id, frameId: 0, value: "2020-03", source: "profile" },
      { id: text!.id, frameId: 0, value: "2020-03", source: "profile" },
    ]);
    const [dateInput, textInput] = document.querySelectorAll("input");
    expect([(dateInput as HTMLInputElement).value, (textInput as HTMLInputElement).value]).toEqual(["2020-03-01", "03/2020"]);
  });

  test("highlights are colored by source, unknown fields get no outline, and removable", async () => {
    document.body.innerHTML = `<input aria-label="A" /><input aria-label="B" /><input aria-label="C *" required />`;
    const [a, b, c] = form.scan();
    await form.fill([
      { id: a!.id, frameId: 0, value: "x", source: "profile" },
      { id: b!.id, frameId: 0, value: "y", source: "ai" },
    ]);
    form.markUnknown([{ id: c!.id, isRequired: true }], true);
    const marks = [...document.querySelectorAll("input")].map((input) => input.dataset.sjHighlight);
    expect(marks).toEqual(["profile", "ai", undefined]);
    form.clearHighlights();
    expect(document.querySelectorAll("[data-sj-highlight]")).toHaveLength(0);
  });
});

// Markup below is trimmed from real pages (Lever / Greenhouse job-boards), see test/live/realsites.ts.
describe("real-world markup", () => {
  const leverQuestion = (label: string, inner: string) =>
    `<li class="application-question custom-question"><div><div class="application-label full-width"><div class="text">${label}<span class="required">✱</span></div></div><div class="application-field full-width">${inner}</div></div></li>`;
  const leverChoices = (type: string, name: string, values: string[]) =>
    `<ul>${values.map((value) => `<li><label><input type="${type}" name="${name}" value="${value}" required><span class="application-answer-alternative">${value}</span></label></li>`).join("")}</ul>`;

  test("Lever radio group takes its question from the sibling .application-label", () => {
    const [field] = scanHtml(`<ul>${leverQuestion("Are you legally authorized to work in the country for which you are applying?", leverChoices("radio", "cards[a][field0]", ["Yes", "No"]))}</ul>`);
    expect(field).toMatchObject({ kind: "radio", label: "Are you legally authorized to work in the country for which you are applying?", options: ["Yes", "No"], required: true });
  });

  test("Lever checkbox group is one descriptor; checked options are joined", async () => {
    const fields = scanHtml(`<ul>${leverQuestion("Language Skill(s) (Check all that apply)", leverChoices("checkbox", "cards[a][field0]", ["English (ENG)", "Spanish (SPA)", "French (FRA)"]))}</ul>`);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: "checkbox", label: "Language Skill(s) (Check all that apply)", options: ["English (ENG)", "Spanish (SPA)", "French (FRA)"], currentValue: "" });
    const [result] = await form.fill([{ id: fields[0]!.id, frameId: 0, value: "English | French", source: "ai" }]);
    expect(result).toMatchObject({ ok: true, finalValue: "English (ENG) | French (FRA)" });
    expect([...document.querySelectorAll<HTMLInputElement>("input")].map((box) => box.checked)).toEqual([true, false, true]);
  });

  test("label ignores hidden 'no results' noise and stops at the input", () => {
    const [field] = scanHtml(`<label><div class="application-label">Current location <span class="required">✱</span></div><div class="application-field"><input name="location" required>
      <div class="dropdown-container" style="display: none;"><div class="dropdown-no-results">No location found. Try entering a different location</div></div></div></label>`);
    expect(field?.label).toBe("Current location");
  });

  test("live-region text never leaks into a label", () => {
    const [field] = scanHtml(`<label for="a">Phone <span role="alert">Invalid number</span><span aria-live="polite">3 results</span></label><input id="a" />`);
    expect(field?.label).toBe("Phone");
  });

  test("a generic placeholder loses to the question heading above the input", () => {
    const [field] = scanHtml(`<li>${`<div class="application-label"><div class="text">Name Pronunciation | How do you pronounce your name?</div></div><div class="application-field"><input type="text" placeholder="Type your response" name="cards[a][field2]"></div>`}</li>`);
    expect(field?.label).toBe("Name Pronunciation | How do you pronounce your name?");
  });

  test("a neighbouring question's heading is not borrowed", () => {
    const fields = scanHtml(`<div><div class="application-label">Why us?</div><div class="application-field"><textarea name="a"></textarea></div></div><div><div class="application-field"><input type="text" name="b" placeholder="Anything else"></div></div>`);
    expect(fields.map((field) => field.label)).toEqual(["Why us?", "Anything else"]);
  });

  const reactSelect = (id: string, label: string, shown: string) => `
    <div class="select__container"><label id="${id}-label" for="${id}" class="label select__label">${label}<span aria-hidden="true">*</span></label>
      <div class="select-shell"><span role="log" aria-live="polite" class="a11yText">option No focused</span>
        <div class="select__control"><div class="select__value-container">${shown}
          <div class="select__input-container"><input class="select__input" id="${id}" type="text" role="combobox" aria-haspopup="true" aria-labelledby="${id}-label" aria-required="true" value=""></div></div></div>
        <input required tabindex="-1" aria-hidden="true" class="requiredInput" value=""></div></div>`;

  test("react-select: shadow required input ignored, value read from the single-value node, placeholder is empty", () => {
    const fields = scanHtml(
      reactSelect("question_1", "Will you now require sponsorship?", '<div class="select__single-value">No</div>') +
        reactSelect("question_2", "Have you worked here?", '<div class="select__placeholder">Select...</div>'),
    );
    expect(fields.map((field) => [field.kind, field.label, field.currentValue, field.required])).toEqual([
      ["combobox", "Will you now require sponsorship?", "No", true],
      ["combobox", "Have you worked here?", "", true],
    ]);
  });

  test("file input labelled 'Attach' takes the group's real name", () => {
    const fields = scanHtml(`
      <div role="group" aria-labelledby="upload-label-resume"><div id="upload-label-resume">Resume/CV<span>*</span></div><button type="button">Attach</button><label for="resume">Attach</label><input id="resume" type="file"></div>
      <div role="group" aria-labelledby="upload-label-cover_letter"><div id="upload-label-cover_letter">Cover Letter</div><label for="cover_letter">Attach</label><input id="cover_letter" type="file"></div>`);
    expect(fields.map((field) => field.label)).toEqual(["Resume/CV", "Cover Letter"]);
  });

  test("a type-ahead input picks the first suggestion and keeps typed text when none appears", async () => {
    document.body.innerHTML = `<label for="l">Current location</label><input id="l" name="location"><div class="dropdown-results"></div>`;
    const results = document.querySelector(".dropdown-results")!;
    const input = document.getElementById("l") as HTMLInputElement;
    input.addEventListener("keyup", () => (results.innerHTML = `<div class="dropdown-location">San Francisco, CA, USA</div>`));
    results.addEventListener("click", (event) => (input.value = (event.target as HTMLElement).textContent ?? ""));
    const [field] = form.scan();
    const [result] = await form.fill([{ id: field!.id, frameId: 0, value: "San Francisco, California", source: "profile" }]);
    expect(result).toMatchObject({ ok: true, finalValue: "San Francisco, CA, USA" });

    document.body.innerHTML = `<label for="l">Current location</label><input id="l" name="location">`;
    const [plain] = form.scan();
    const [typed] = await form.fill([{ id: plain!.id, frameId: 0, value: "Berlin, Germany", source: "profile" }]);
    expect(typed?.finalValue).toBe("Berlin, Germany");
  });
});
