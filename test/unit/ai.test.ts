import { describe, expect, test } from "bun:test";
import * as profileExtract from "../../src/ai/profileExtract.ts";
import * as tasks from "../../src/ai/tasks.ts";
import { emptyProfile } from "../../src/storage.ts";
import type { FieldDescriptor, JobPosting } from "../../src/types.ts";
import { FakeLlm } from "./fakeLlm.ts";

const resumeText = `Jane Doe
jane.doe@example.com | +91 98765 43210 | linkedin.com/in/janedoe | github.com/janedoe
Senior Engineer at Acme Corp (Mar 2019 - Present). Built Python and Kubernetes services on AWS with PostgreSQL. Led a team, strong stakeholder management.`;

const candidate: tasks.CandidateContext = { profile: { ...emptyProfile, firstName: "Jane", lastName: "Doe", skills: ["Python", "k8s", "Leadership"], experience: [{ title: "Senior Engineer", company: "Acme Corp", location: "", start: "2019-03", end: "", current: true, description: "" }] }, resumeText };

const job: JobPosting = { id: "1", url: "https://x.test/1", title: "Backend Engineer", company: "Globex", location: "Remote", description: "We need Python, Kubernetes, Terraform and AWS. React is a plus. Stakeholder management. Experience with GCP.", salaryText: "", employmentType: "Full-time", source: "generic" };

const field = (id: string, patch: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ id, frameId: 0, kind: "text", label: id, name: "", placeholder: "", automationId: "", required: false, options: [], currentValue: "", section: "", ...patch });

describe("keywordMatch", () => {
  test("aliases and acronyms", () => {
    const result = tasks.keywordMatch(job.description, candidate);
    expect(result.matched).toEqual(expect.arrayContaining(["Python", "Kubernetes", "AWS", "Stakeholder Management"]));
    expect(result.missing).toEqual(expect.arrayContaining(["Terraform", "React", "GCP"]));
    expect(result.score).toBe(Math.round((result.matched.length / (result.matched.length + result.missing.length)) * 100));
  });
  test("special-character skills", () => {
    const text = "C++, C#, .NET and Node.js experience; JavaScript not Java";
    const result = tasks.keywordMatch(text, { profile: emptyProfile, resumeText: "I know c# and javascript, plus node" });
    expect(result.matched).toEqual(expect.arrayContaining(["C#", "JavaScript", "Node.js"]));
    expect(result.missing).toEqual(expect.arrayContaining(["C++", ".NET", "Java"]));
  });
  test("word boundaries: java does not match javascript", () => {
    const result = tasks.keywordMatch("Java", { profile: emptyProfile, resumeText: "I write JavaScript" });
    expect(result.matched).toEqual([]);
  });
  test("nothing found", () => {
    expect(tasks.keywordMatch("we like cake", { profile: emptyProfile, resumeText: "" })).toEqual({ score: 0, matched: [], missing: [] });
  });
  test("capitalized acronyms, stoplist honoured", () => {
    const result = tasks.keywordMatch("Knowledge of FIX and EEO policy in the USA", { profile: emptyProfile, resumeText: "fix protocol" });
    expect(result.matched).toEqual(["FIX"]);
    expect(result.missing).toEqual([]);
  });
});

describe("analyzeJob", () => {
  test("normalizes messy output and adds keyword fields", async () => {
    const fake = new FakeLlm([
      '<think>scoring</think>Here you go:\n```json\n{"summary": "A backend role.", "mustHave": "Python; AWS", "niceToHave": ["React", "React"], "matchScore": "140", "strengths": ["Python",], "gaps": null,}\n```',
    ]);
    const result = await tasks.analyzeJob(fake, job, candidate);
    expect(result).toMatchObject({ summary: "A backend role.", mustHave: ["Python", "AWS"], niceToHave: ["React"], matchScore: 100, strengths: ["Python"], gaps: [], verdict: "Strong match" });
    expect(result.matchedSkills).toContain("Python");
    expect(result.missingSkills).toContain("Terraform");
    expect(result.keywordScore).toBeGreaterThan(0);
  });
  test("retries on non-JSON and truncates long input", async () => {
    const fake = new FakeLlm(["no idea", '{"matchScore": 30}']);
    const long = { ...job, description: "x".repeat(20000) };
    const result = await tasks.analyzeJob(fake, long, { ...candidate, resumeText: "y".repeat(20000) });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0]!.user.length).toBeLessThan(13500);
    expect(result).toMatchObject({ matchScore: 30, verdict: "Weak match", summary: "" });
  });
  test("throws when the model never returns JSON", async () => {
    await expect(tasks.analyzeJob(new FakeLlm(["nope"]), job, candidate)).rejects.toThrow();
  });
});

describe("extractProfile", () => {
  const raw = {
    name: "Jane Doe",
    email: "wrong@model.com",
    phone: "000",
    linkedin: "linkedin.com/in/wrong",
    city: "Bengaluru",
    skills: ["Python", "python", " AWS "],
    experience: [
      { title: "Engineer", company: "Initech", start: "2015", end: "Dec 2018", description: ["a", "b"] },
      { title: "Senior Engineer", company: "Acme Corp", start: "03/2019", end: "Present" },
      { title: "", company: "" },
    ],
    education: [{ school: "MIT", degree: "BS", end: "2014-05-01" }],
  };
  test("deterministic contacts override the model; defaults filled", async () => {
    const fake = new FakeLlm([`prose ${JSON.stringify(raw)} trailing`]);
    const profile = await tasks.extractProfile(fake, resumeText);
    expect(profile).toMatchObject({
      firstName: "Jane", lastName: "Doe", email: "jane.doe@example.com", phone: "+91 98765 43210", phoneCountryCode: "+91",
      linkedin: "https://linkedin.com/in/janedoe", github: "https://github.com/janedoe", city: "Bengaluru",
      currentTitle: "Senior Engineer", currentCompany: "Acme Corp", skills: ["Python", "AWS"], workAuthorized: "", gender: "",
    });
    expect(profile.experience).toHaveLength(2);
    expect(profile.experience[0]).toMatchObject({ start: "2015-01", end: "2018-12", current: false, description: "a\nb" });
    expect(profile.experience[1]).toMatchObject({ start: "2019-03", end: "", current: true });
    expect(profile.education[0]).toMatchObject({ school: "MIT", end: "2014-05" });
    expect(Object.keys(profile).sort()).toEqual(Object.keys(emptyProfile).sort());
  });
  test("yearsExperience computed from non-overlapping union", () => {
    const now = new Date(2024, 2, 15);
    const mk = (start: string, end: string, current = false) => ({ title: "t", company: "c", location: "", start, end, current, description: "" });
    expect(profileExtract.yearsFromExperience([mk("2020-01", "2022-01"), mk("2021-01", "2023-01")], now)).toBe(3);
    expect(profileExtract.yearsFromExperience([mk("2020-03", "", true)], now)).toBe(4);
    expect(profileExtract.yearsFromExperience([], now)).toBe(0);
  });
  test("model years respected; garbage tolerated", () => {
    expect(profileExtract.buildProfile({ yearsExperience: "7" }, "").yearsExperience).toBe(7);
    expect(profileExtract.buildProfile(null, "").firstName).toBe("");
    expect(profileExtract.buildProfile({ experience: "oops", skills: "a, b; c" }, "").skills).toEqual(["a", "b", "c"]);
  });
  test("re-extraction keeps what the user typed when the resume lacks it", () => {
    const previous = { ...emptyProfile, postalCode: "560068", noticePeriod: "15 days", city: "Old", skills: ["a"] };
    const extracted = { ...emptyProfile, city: "Bangalore", skills: [] };
    expect(profileExtract.mergeInto(previous, extracted)).toMatchObject({ postalCode: "560068", noticePeriod: "15 days", city: "Bangalore", skills: ["a"] });
  });
  test("normalizeMonth", () => {
    expect(profileExtract.normalizeMonth("Mar 2021")).toBe("2021-03");
    expect(profileExtract.normalizeMonth("2021-3")).toBe("2021-03");
    expect(profileExtract.normalizeMonth("Present")).toBe("");
    expect(profileExtract.normalizeMonth(undefined)).toBe("");
  });
});

describe("answerFields", () => {
  const fields = [
    field("gender", { kind: "select", options: ["Male", "Female", "Decline to self-identify"] }),
    field("auth", { kind: "radio", options: ["Yes", "No"] }),
    field("why", { kind: "textarea", label: "Why Globex?" }),
    field("cv", { kind: "file" }),
    field("agree", { kind: "checkbox" }),
    field("src", { kind: "combobox", options: ["LinkedIn", "Referral"] }),
  ];
  test("validates ids and options, fuzzy-corrects, skips files", async () => {
    const fake = new FakeLlm([
      JSON.stringify({ answers: { gender: "decline to self identify", auth: "yes.", why: " I build payments. ", cv: "resume.pdf", agree: true, src: "Twitter", nope: "x" } }),
    ]);
    const answers = await tasks.answerFields(fake, fields, candidate, job);
    expect(answers).toEqual({ gender: "Decline to self-identify", auth: "Yes", why: "I build payments.", agree: "true" });
    expect(fake.requests[0]!.user).not.toContain('"id":"cv"');
  });
  test("accepts flat maps and array shape", () => {
    expect(tasks.normalizeAnswers({ auth: "No" }, fields)).toEqual({ auth: "No" });
    expect(tasks.normalizeAnswers({ answers: [{ id: "auth", answer: "Yes" }] }, fields)).toEqual({ auth: "Yes" });
    expect(tasks.normalizeAnswers("junk", fields)).toEqual({});
  });
  test("no answerable fields skips the call", async () => {
    const fake = new FakeLlm(["{}"]);
    expect(await tasks.answerFields(fake, [field("cv", { kind: "file" })], candidate, null)).toEqual({});
    expect(fake.requests).toHaveLength(0);
  });
});

describe("writing", () => {
  test("answerQuestion strips fences and quotes", async () => {
    const fake = new FakeLlm(['<think>x</think>"I like payments."']);
    expect(await tasks.answerQuestion(fake, "Why us?", candidate, job)).toBe("I like payments.");
    expect(fake.requests[0]!.user).toContain("Globex");
  });
  test("cover letter removes placeholders", async () => {
    const fake = new FakeLlm(["[Your Address]\n\nDear Hiring Team,\n\nI want to join [Company Name] as a [Role].\n\n\n\nJane"]);
    const letter = await tasks.writeCoverLetter(fake, job, candidate, { tone: "concise", words: 200 });
    expect(letter).toBe("Dear Hiring Team,\n\nI want to join Globex as a .\n\nJane");
    expect(fake.requests[0]!.system).toContain("about 200 words");
  });
});

describe("tailorResume", () => {
  test("normalizes changes and warns when an employer vanishes", async () => {
    const fake = new FakeLlm(['{"markdown": "# Jane\\nSenior Engineer at Initech", "changes": [{"before": "a", "after": "b", "reason": "kw"}, {"after": ""}, "junk"]}']);
    const result = await tasks.tailorResume(fake, job, candidate);
    expect(result.markdown).toContain("Initech");
    expect(result.changes).toHaveLength(2);
    expect(result.changes[1]!.reason).toContain('"Acme Corp" is missing');
  });
  test("empty markdown falls back to original resume", async () => {
    const result = await tasks.tailorResume(new FakeLlm(['{"markdown": ""}']), job, candidate);
    expect(result.markdown).toBe(resumeText);
    expect(result.changes).toEqual([]);
  });
});
