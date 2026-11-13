import { describe, expect, test } from "bun:test";
import * as linkedinProfile from "../../src/ai/linkedinProfile.ts";
import * as models from "../../src/ai/models.ts";
import * as roles from "../../src/ai/roles.ts";
import { emptyProfile, isSetupComplete } from "../../src/storage.ts";
import type { Experience, Profile } from "../../src/types.ts";

const job = (patch: Partial<Experience>): Experience => ({ title: "", company: "", location: "", start: "", end: "", current: false, description: "", ...patch });
const profile = (patch: Partial<Profile>): Profile => ({ ...emptyProfile, ...patch });

describe("linkedin merge", () => {
  test("resume values win, LinkedIn fills blanks, summary is replaced", () => {
    const current = profile({ firstName: "Jane", city: "", headline: "Resume headline", linkedinSummary: "old" });
    const imported = profile({ firstName: "J.", city: "Pune", headline: "LinkedIn headline", linkedinSummary: "new digest" });
    const merged = linkedinProfile.merge(current, imported);
    expect(merged.firstName).toBe("Jane");
    expect(merged.headline).toBe("Resume headline");
    expect(merged.city).toBe("Pune");
    expect(merged.linkedinSummary).toBe("new digest");
  });

  test("keeps the old digest when the import has none", () => {
    expect(linkedinProfile.merge(profile({ linkedinSummary: "old" }), profile({})).linkedinSummary).toBe("old");
  });

  test("unions skills case-insensitively", () => {
    const merged = linkedinProfile.merge(profile({ skills: ["Python", "Go"] }), profile({ skills: ["python", "Rust"] }));
    expect(merged.skills).toEqual(["Python", "Go", "Rust"]);
  });

  test("dedupes experience by company and title, fills blanks, adds new roles newest first", () => {
    const current = profile({ experience: [job({ title: "Engineering Manager", company: "Acme Corp", start: "2020-01", current: true })] });
    const imported = profile({
      experience: [
        job({ title: "Senior Engineering Manager", company: "Acme", location: "Pune", description: "Led 20 people" }),
        job({ title: "Developer", company: "Globex", start: "2015-05", end: "2019-12" }),
      ],
    });
    const merged = linkedinProfile.merge(current, imported).experience;
    expect(merged.map((item) => item.company)).toEqual(["Acme Corp", "Globex"]);
    expect(merged[0]).toMatchObject({ title: "Engineering Manager", location: "Pune", description: "Led 20 people" });
  });

  test("same company matches on equal start month even when titles differ", () => {
    const current = profile({ experience: [job({ title: "SDE II", company: "Acme", start: "2018-03" })] });
    const imported = profile({ experience: [job({ title: "Software Engineer 2", company: "Acme", start: "2018-03" })] });
    expect(linkedinProfile.merge(current, imported).experience).toHaveLength(1);
  });

  test("education dedupes by school but keeps a second degree", () => {
    const base = { field: "", start: "", end: "", gpa: "" };
    const current = profile({ education: [{ school: "MIT", degree: "BS", ...base }] });
    const imported = profile({ education: [{ school: "MIT", degree: "", ...base, end: "2012-05" }, { school: "MIT", degree: "MS", ...base }] });
    const merged = linkedinProfile.merge(current, imported).education;
    expect(merged.map((item) => item.degree)).toEqual(["BS", "MS"]);
    expect(merged[0]!.end).toBe("2012-05");
  });
});

describe("linkedin text and urls", () => {
  test("cleanPageText drops blanks, UI words and consecutive duplicates", () => {
    expect(linkedinProfile.cleanPageText("Engineer\nEngineer\n\n  Like \nAcme\nacme\nSee more")).toBe("Engineer\nAcme");
  });
  test("buildInput labels pages and skips empty ones", () => {
    const input = linkedinProfile.buildInput([{ label: "Skills", text: "Python" }, { label: "Education", text: "  \n" }]);
    expect(input).toBe("### Skills\nPython");
  });
  test("profileRoot and isLoginUrl", () => {
    expect(linkedinProfile.profileRoot("linkedin.com/in/jane-doe/details/skills/?x=1")).toBe("https://www.linkedin.com/in/jane-doe/");
    expect(linkedinProfile.profileRoot("https://example.com")).toBe("");
    expect(linkedinProfile.isLoginUrl("https://www.linkedin.com/authwall?trk=x")).toBe(true);
    expect(linkedinProfile.isLoginUrl("https://www.linkedin.com/in/jane/")).toBe(false);
  });
  test("build fills the profile url and caps the digest", () => {
    const built = linkedinProfile.build({ name: "Jane Doe", skills: ["Go"], linkedinSummary: "x".repeat(4000) }, "https://www.linkedin.com/in/jane/");
    expect(built).toMatchObject({ firstName: "Jane", lastName: "Doe", linkedin: "https://www.linkedin.com/in/jane/" });
    expect(built.linkedinSummary.length).toBeLessThanOrEqual(linkedinProfile.summaryLimit + 1);
  });
});

describe("roles", () => {
  test("searchUrl puts the place and remote into the query LinkedIn understands", () => {
    expect(roles.searchUrl("Engineering Manager", "New York, NY", false)).toBe("https://www.linkedin.com/jobs/search-results/?keywords=Engineering%20Manager%20in%20New%20York%2C%20NY");
    expect(roles.searchUrl("QA", "", true)).toBe("https://www.linkedin.com/jobs/search-results/?keywords=Remote%20QA");
  });
  test("buildSearches trims the location", () => {
    expect(roles.buildSearches(["SRE"], " Pune ", false)[0]).toMatchObject({ role: "SRE", location: "Pune" });
  });
  test("parseRoles dedupes and caps, falls back to the current title", () => {
    expect(roles.parseRoles({ roles: ["A", "a", "B"] }, emptyProfile)).toEqual(["A", "B"]);
    expect(roles.parseRoles({ roles: Array.from({ length: 12 }, (_, index) => `R${index}`) }, emptyProfile)).toHaveLength(8);
    expect(roles.parseRoles({}, profile({ currentTitle: "Tech Lead" }))).toEqual(["Tech Lead"]);
  });
});

describe("models and setup", () => {
  test("parseIds reads OpenAI-style lists and skips embeddings", () => {
    expect(models.parseIds({ data: [{ id: "qwen" }, { id: "text-embedding-3" }, { id: "llama" }, { id: "qwen" }] })).toEqual(["llama", "qwen"]);
    expect(models.parseIds("nope")).toEqual([]);
  });
  test("isSetupComplete: explicit flag wins, existing users count as done", () => {
    expect(isSetupComplete({ setupComplete: false, settings: {}, profile: { firstName: "A" } })).toBe(false);
    expect(isSetupComplete({ settings: {}, profile: { firstName: "A" } })).toBe(true);
    expect(isSetupComplete({ settings: {}, profile: { firstName: "" } })).toBe(false);
    expect(isSetupComplete({ profile: { firstName: "A" } })).toBe(false);
    expect(isSetupComplete({})).toBe(false);
  });
});
