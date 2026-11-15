import { describe, expect, test } from "bun:test";
import * as mapping from "../../src/fill/mapping.ts";
import { emptyProfile } from "../../src/storage.ts";
import type { AnswerBank, FieldDescriptor, Profile, Resume } from "../../src/types.ts";

export const profile: Profile = {
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
  summary: "Backend engineer.",
  currentTitle: "Senior Engineer",
  currentCompany: "Acme",
  yearsExperience: 6,
  experience: [
    { title: "Senior Engineer", company: "Acme", location: "Remote", start: "2020-03", end: "", current: true, description: "Built things" },
    { title: "Engineer", company: "Globex", location: "NYC", start: "2016-06", end: "2020-02", current: false, description: "Earlier" },
  ],
  education: [{ school: "MIT", degree: "Bachelor of Science", field: "Computer Science", start: "2012-09", end: "2016-05", gpa: "3.8" }],
  workAuthorized: "yes",
  requiresSponsorship: "no",
  willingToRelocate: "yes",
  salaryExpectation: "$180,000",
  noticePeriod: "2 weeks",
  pronouns: "she/her",
};

const resume: Resume = { text: "r", fileName: "resume.pdf", fileBase64: "AAAA", mimeType: "application/pdf" };

let counter = 0;
function field(overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    id: `f${counter++}`,
    frameId: 0,
    kind: "text",
    label: "",
    name: "",
    placeholder: "",
    automationId: "",
    required: false,
    options: [],
    currentValue: "",
    section: "",
    ...overrides,
  };
}

function fillOne(target: FieldDescriptor, p: Profile = profile, answers: AnswerBank = {}, r?: Resume | null) {
  return mapping.map([target], p, answers, r)[0];
}

describe("normalize", () => {
  test("strips punctuation, asterisks, (required) and collapses spaces", () => {
    expect(mapping.normalize("  Why do you want   to work here? *")).toBe("why do you want to work here");
    expect(mapping.normalize("Email Address (required)")).toBe("email address");
  });
});

describe("identity and contact", () => {
  test("Workday automation ids", () => {
    const first = field({ automationId: "formField-legalNameSection_firstName" });
    const last = field({ automationId: "formField-legalNameSection_lastName" });
    const email = field({ automationId: "email", kind: "email" });
    const fills = mapping.map([first, last, email], profile, {});
    expect(fills.map((fill) => fill.value)).toEqual(["Priya", "Raman", "priya@example.com"]);
  });

  test("Greenhouse names", () => {
    expect(fillOne(field({ label: "First Name", name: "job_application[first_name]" }))?.value).toBe("Priya");
    expect(fillOne(field({ label: "Last Name", name: "job_application[last_name]" }))?.value).toBe("Raman");
  });

  test("full name single field (Lever)", () => {
    expect(fillOne(field({ label: "Full name", name: "name" }))?.value).toBe("Priya Raman");
    expect(fillOne(field({ label: "", name: "name" }))?.value).toBe("Priya Raman");
  });

  test("middle name is filled only when the profile has one, preferred name uses first name", () => {
    expect(fillOne(field({ label: "Middle Name" }))).toBeUndefined();
    expect(mapping.map([field({ label: "Middle Name" })], { ...profile, middleName: "Krishna" }, {})[0]?.value).toBe("Krishna");
    expect(mapping.map([field({ label: "Middle Initial" })], { ...profile, middleName: "Krishna" }, {})[0]?.value).toBe("K");
    expect(mapping.map([field({ label: "Alternate phone number" })], { ...profile, otherPhones: ["+91 9632544966"] }, {})[0]?.value).toBe("+91 9632544966");
    expect(fillOne(field({ label: "Preferred Name" }))?.value).toBe("Priya");
  });

  test("phone is split from country code when a code field exists", () => {
    const code = field({ label: "Country Phone Code", kind: "combobox" });
    const phone = field({ label: "Phone Number", automationId: "phone-number", kind: "tel" });
    const [codeFill, phoneFill] = mapping.map([code, phone], profile, {});
    expect(codeFill?.value).toBe("United States +1");
    expect(phoneFill?.value).toBe("4155550100");
  });

  test("phone stays whole without a code field", () => {
    expect(fillOne(field({ label: "Phone", kind: "tel" }))?.value).toBe("+1 415 555 0100");
  });

  test("a national number gets its country code back when the form has no code field", () => {
    expect(fillOne(field({ label: "Phone", kind: "tel" }), { ...profile, phone: "415 555 0100" })?.value).toBe("+1 415 555 0100");
  });

  test("phone device type selects Mobile", () => {
    const type = field({ label: "Phone Device Type", kind: "select", options: ["Select One", "Home", "Mobile", "Work"] });
    expect(fillOne(type)?.value).toBe("Mobile");
  });

  test("country code select picks the United States option", () => {
    const code = field({ label: "Phone Country Code", kind: "select", options: ["Canada (+1)", "United States (+1)", "India (+91)"] });
    expect(fillOne(code, { ...profile, phone: "4155550100" })?.value).toBe("United States (+1)");
  });
});

describe("address and links", () => {
  test("address pieces", () => {
    const fills = mapping.map(
      [
        field({ label: "Address Line 1" }),
        field({ label: "City", automationId: "addressSection_city" }),
        field({ label: "State/Province" }),
        field({ label: "Zip Code" }),
        field({ label: "Address Line 2" }),
      ],
      profile,
      {},
    );
    expect(fills.map((fill) => fill.value)).toEqual(["12 Market St", "San Francisco", "California", "94105"]);
  });

  test("state select accepts abbreviations and names", () => {
    const state = field({ label: "State", kind: "select", options: ["Select", "AL", "CA", "NY"] });
    expect(fillOne(state)?.value).toBe("CA");
  });

  test("country select matches United States of America", () => {
    const country = field({ label: "Country", automationId: "countryDropdown", kind: "combobox", options: ["Canada", "United States of America"] });
    expect(fillOne(country)?.value).toBe("United States of America");
  });

  test("country text with unknown options still raw for comboboxes", () => {
    expect(fillOne(field({ label: "Country", kind: "combobox" }))?.value).toBe("United States");
  });

  test("links", () => {
    const fills = mapping.map(
      [field({ label: "LinkedIn Profile" }), field({ label: "GitHub" }), field({ label: "Portfolio" }), field({ label: "Website" })],
      profile,
      {},
    );
    expect(fills.map((fill) => fill.value)).toEqual([profile.linkedin, profile.github, profile.portfolio, profile.website]);
  });

  test("Lever urls[LinkedIn] by name", () => {
    expect(fillOne(field({ label: "", name: "urls[LinkedIn]" }))?.value).toBe(profile.linkedin);
  });
});

describe("work and education", () => {
  test("current company / title / years", () => {
    expect(fillOne(field({ label: "Current company" }))?.value).toBe("Acme");
    expect(fillOne(field({ label: "Current job title" }))?.value).toBe("Senior Engineer");
    expect(fillOne(field({ label: "Years of experience" }))?.value).toBe("6");
  });

  test("years of experience picks the range option", () => {
    const years = field({ label: "Years of professional experience", kind: "select", options: ["0-2", "3-5", "6-10", "10+"] });
    expect(fillOne(years)?.value).toBe("6-10");
  });

  test("experience index comes from the section number", () => {
    const one = field({ label: "Job Title", section: "Work Experience 1" });
    const two = field({ label: "Job Title", section: "Work Experience 2" });
    const company = field({ label: "Company", section: "Work Experience 2" });
    expect(mapping.map([one, two, company], profile, {}).map((fill) => fill.value)).toEqual(["Senior Engineer", "Engineer", "Globex"]);
  });

  test("experience dates are MM/YYYY; current job has no end date", () => {
    const start = field({ label: "From", section: "Work Experience 2", placeholder: "MM/YYYY" });
    const end = field({ label: "To", section: "Work Experience 2" });
    const currentEnd = field({ label: "To", section: "Work Experience 1" });
    const fills = mapping.map([start, end, currentEnd], profile, {});
    expect(fills.map((fill) => fill.value)).toEqual(["06/2016", "02/2020"]);
  });

  test("date kind keeps canonical YYYY-MM", () => {
    expect(fillOne(field({ label: "From", kind: "date", section: "Work Experience 1" }))?.value).toBe("2020-03");
  });

  test("currently work here checkbox", () => {
    expect(fillOne(field({ label: "I currently work here", kind: "checkbox", options: [], section: "Work Experience 1" }))?.value).toBe("true");
    expect(fillOne(field({ label: "I currently work here", kind: "checkbox", section: "Work Experience 2" }))?.value).toBe("false");
  });

  test("education", () => {
    const fills = mapping.map(
      [
        field({ label: "School or University", section: "Education" }),
        field({ label: "Degree", kind: "select", options: ["Select One", "Associate's Degree", "Bachelor's Degree", "Master's Degree"], section: "Education" }),
        field({ label: "Field of Study", section: "Education" }),
        field({ label: "GPA", section: "Education" }),
        field({ label: "Graduation Year" }),
      ],
      profile,
      {},
    );
    expect(fills.map((fill) => fill.value)).toEqual(["MIT", "Bachelor's Degree", "Computer Science", "3.8", "2016"]);
  });
});

describe("questions", () => {
  const yesNoOptions = ["Yes", "No"];

  test("work authorization and sponsorship radios", () => {
    const authorized = field({ kind: "radio", label: "Are you legally authorized to work in the United States?", options: yesNoOptions });
    const sponsor = field({ kind: "radio", label: "Will you now or in the future require sponsorship for employment visa status?", options: yesNoOptions });
    expect(mapping.map([authorized, sponsor], profile, {}).map((fill) => fill.value)).toEqual(["Yes", "No"]);
  });

  test("combined authorized-without-sponsorship question", () => {
    const both = field({ kind: "select", label: "Are you authorized to work in the US without visa sponsorship?", options: ["Yes", "No"] });
    expect(fillOne(both)?.value).toBe("Yes");
    expect(fillOne(both, { ...profile, requiresSponsorship: "yes" })?.value).toBe("No");
  });

  test("unknown yes/no profile values are left for AI", () => {
    const sponsor = field({ kind: "radio", label: "Do you require sponsorship?", options: yesNoOptions });
    expect(fillOne(sponsor, { ...profile, requiresSponsorship: "" })).toBeUndefined();
  });

  test("relocation, salary, notice", () => {
    const fills = mapping.map(
      [
        field({ kind: "select", label: "Are you willing to relocate?", options: ["Yes", "No"] }),
        field({ label: "Desired salary" }),
        field({ label: "Notice period" }),
      ],
      profile,
      {},
    );
    expect(fills.map((fill) => fill.value)).toEqual(["Yes", "$180,000", "2 weeks"]);
  });

  test("Indian CTC fields: current vs expected", () => {
    const labels = ["Current CTC", "Current fixed CTC", "Last drawn salary", "Expected CTC"];
    const fills = mapping.map(labels.map((label, index) => field({ id: String(index), label })), { ...profile, currentSalary: "₹60L" }, {});
    expect(fills.map((fill) => fill.value)).toEqual(["₹60L", "₹60L", "₹60L", "$180,000"]);
  });

  test("number inputs get numbers: notice period in days, CTC in LPA, contact number", () => {
    const indian = { ...profile, noticePeriod: "2 weeks", currentSalary: "60 LPA" };
    const fills = mapping.map(
      [
        field({ id: "n", kind: "number", label: "What is the duration of your notice period? (In Days)" }),
        field({ id: "c", kind: "number", label: "What is your current CTC? (In LPA)" }),
        field({ id: "p", kind: "tel", label: "Contact number" }),
      ],
      indian,
      {},
    );
    expect(fills.map((fill) => fill.value)).toEqual(["14", "60", profile.phone]);
  });

  test("current company on a career break falls back to the most recent employer", () => {
    const onBreak = { ...profile, currentCompany: "", experience: [{ ...profile.experience[0]!, company: "", title: "Career break" }, profile.experience[1]!] };
    expect(fillOne(field({ label: "Current company" }), onBreak)?.value).toBe("Globex");
  });

  test("EEO with empty profile values picks decline options", () => {
    const gender = field({ kind: "select", label: "Gender", options: ["Select...", "Male", "Female", "Decline To Self Identify"] });
    const race = field({ kind: "select", label: "Race", options: ["Asian", "White", "I prefer not to answer"] });
    const veteran = field({ kind: "select", label: "Veteran Status", options: ["I am a veteran", "I don't wish to answer"] });
    const disability = field({ kind: "select", label: "Disability Status", options: ["Yes, I have a disability", "No", "I do not want to answer"] });
    const values = mapping.map([gender, race, veteran, disability], profile, {}).map((fill) => fill.value);
    expect(values).toEqual(["Decline To Self Identify", "I prefer not to answer", "I don't wish to answer", "I do not want to answer"]);
  });

  test("EEO with a profile value picks that option, not the substring", () => {
    const gender = field({ kind: "select", label: "Gender", options: ["Male", "Female"] });
    expect(fillOne(gender, { ...profile, gender: "Female" })?.value).toBe("Female");
    expect(fillOne(gender, { ...profile, gender: "Male" })?.value).toBe("Male");
  });

  test("pronouns only when set", () => {
    expect(fillOne(field({ label: "Pronouns" }))?.value).toBe("she/her");
    expect(fillOne(field({ label: "Pronouns" }), { ...profile, pronouns: "" })).toBeUndefined();
  });

  test("how did you hear prefers LinkedIn, then Job Board, then Other", () => {
    const options = ["Select One", "Referral", "Job Board", "Other"];
    expect(fillOne(field({ kind: "combobox", label: "How Did You Hear About Us?", options }))?.value).toBe("Job Board");
    expect(fillOne(field({ kind: "select", label: "How did you hear about us", options: ["Friend", "LinkedIn", "Other"] }))?.value).toBe("LinkedIn");
    expect(fillOne(field({ kind: "select", label: "How did you hear about us", options: ["Friend", "Other"] }))?.value).toBe("Other");
    expect(fillOne(field({ kind: "combobox", label: "How did you hear about us" }))?.value).toStartWith("LinkedIn | Job Board");
  });
});

describe("files, answers and guards", () => {
  test("resume file input is filled; cover letter is skipped", () => {
    const resumeInput = field({ kind: "file", label: "Resume/CV" });
    const cover = field({ kind: "file", label: "Cover Letter" });
    const fills = mapping.map([resumeInput, cover], profile, {}, resume);
    expect(fills).toEqual([{ id: resumeInput.id, frameId: 0, value: "resume", source: "resume" }]);
  });

  test("no resume file means no file fill", () => {
    expect(fillOne(field({ kind: "file", label: "Resume" }), profile, {}, { ...resume, fileBase64: "" })).toBeUndefined();
  });

  test("answer bank wins and is matched by normalized question", () => {
    const answers: AnswerBank = {
      "why do you want to work here": { question: "Why do you want to work here?", answer: "Mission.", updatedAt: 1 },
    };
    const fill = fillOne(field({ kind: "textarea", label: "Why do you want to work here? *" }), profile, answers);
    expect(fill).toMatchObject({ value: "Mission.", source: "answers" });
  });

  test("banked choice answer must match an option", () => {
    const answers: AnswerBank = { "preferred shift": { question: "Preferred shift", answer: "Night", updatedAt: 1 } };
    const shift = field({ kind: "select", label: "Preferred shift", options: ["Day", "Evening"] });
    expect(fillOne(shift, profile, answers)).toBeUndefined();
  });

  test("already filled fields are left alone; unchecked checkbox counts as empty", () => {
    expect(fillOne(field({ label: "First Name", currentValue: "Someone" }))).toBeUndefined();
    expect(fillOne(field({ label: "I currently work here", kind: "checkbox", currentValue: "false", section: "Work Experience 1" }))?.value).toBe("true");
  });

  test("unmappable questions yield no fill", () => {
    expect(fillOne(field({ kind: "textarea", label: "Describe a time you led a project" }))).toBeUndefined();
  });

  test("fill carries id and frameId", () => {
    const target = field({ label: "Email", kind: "email", frameId: 3 });
    expect(fillOne(target)).toEqual({ id: target.id, frameId: 3, value: "priya@example.com", source: "profile" });
  });
});

describe("matchOption", () => {
  test("tiers: exact, prefix, contains, token overlap", () => {
    expect(mapping.matchOption(["Alpha", "Beta"], "beta")).toBe("Beta");
    expect(mapping.matchOption(["United States of America"], "United States")).toBe("United States of America");
    expect(mapping.matchOption(["Option: Senior Software Engineer"], "software engineer")).toBe("Option: Senior Software Engineer");
    expect(mapping.matchOption(["Computer Science and Engineering"], "Engineering Computer")).toBe("Computer Science and Engineering");
  });

  test("synonyms: yes/no, USA, state abbreviations", () => {
    expect(mapping.matchOption(["I am authorized", "No"], "Yes")).toBe("I am authorized");
    expect(mapping.matchOption(["Canada", "USA"], "United States")).toBe("USA");
    expect(mapping.matchOption(["Texas", "Utah"], "TX")).toBe("Texas");
  });

  test("skips placeholder options and returns undefined when nothing matches", () => {
    expect(mapping.matchOption(["Select One", "Foo"], "select")).toBeUndefined();
    expect(mapping.matchOption(["Foo", "Bar"], "zzz")).toBeUndefined();
  });
});

describe("real-world questions (Lever / Greenhouse)", () => {
  const select = (label: string, options: string[]): FieldDescriptor => ({ ...field({ label, kind: "select" }), options });
  const fill = (input: FieldDescriptor) => mapping.map([input], profile, {}).at(0)?.value;

  test("'heard about' phrasing picks LinkedIn", () => {
    expect(fill(select("Please tell us how you heard about this opportunity.", ["Glassdoor", "Job Board (Indeed, Monster, etc.)", "LinkedIn", "Other"]))).toBe("LinkedIn");
  });

  test("school abbreviations match long university pick-lists", () => {
    const options = ["Berkeley College", "University of California - Berkeley", "University of California - Davis", "Other - School Not Listed"];
    const berkeley = { ...profile, education: [{ ...profile.education[0]!, school: "UC Berkeley" }] };
    expect(mapping.matchOption(options, "UC Berkeley")).toBe("University of California - Berkeley");
    expect(mapping.matchOption(options, "UCLA")).toBeUndefined();
    expect(mapping.map([select("Which university did you attend?", options)], berkeley, {})[0]?.value).toBe("University of California - Berkeley");
  });

  test("a label that names an 'Other' option is the fallback when the school is not listed", () => {
    const options = ["Aalborg University", "Other (School Not Listed)"];
    const label = 'Which university did you attend? Please select "Other (School Not Listed)" if your school is not listed.';
    expect(fill(select(label, options))).toBe("Other (School Not Listed)");
    expect(fill(select("Which university did you attend?", options))).toBeUndefined();
  });

  test("a long question mentioning 'employer' is not the current-company field", () => {
    expect(fill(field({ label: "Are you subject to any agreements with your current employer or a past employer?", kind: "combobox" }))).toBeUndefined();
    expect(fill(field({ label: "Current employer" }))).toBe("Acme");
  });

  test("checkbox groups resolve each ' | '-joined part to a real option", () => {
    const group: FieldDescriptor = { ...field({ label: "Race (check all that apply)", kind: "checkbox" }), options: ["Asian", "White", "Decline to self-identify"] };
    expect(fill(group)).toBe("Decline to self-identify");
  });

  test("long questions only hit question rules; relocation applies to choice fields; text 'hear about' is one value", () => {
    const references = "References: Please list 2-3 references who can speak to your work, including their name, title, company and contact details";
    expect(fill(field({ label: references, kind: "textarea" }))).toBeUndefined();
    const address = "What is the address from which you plan on working? If you would be relocating, please enter the address of your new home";
    expect(fill(field({ label: address }))).toBeUndefined();
    expect(fill(field({ label: "How did you hear about this role?" }))).toBe("LinkedIn");
  });
});

describe("account forms", () => {
  const account = { email: "me@jobs.test", password: "s3cret!" };
  test("create-account page: account email + password + confirm password", () => {
    const email = field({ id: "e", kind: "email", label: "Email Address" });
    const password = field({ id: "p", kind: "password", label: "Password" });
    const confirm = field({ id: "c", kind: "password", label: "Verify New Password" });
    const fills = mapping.map([email, password, confirm], profile, {}, null, account);
    expect(fills.map((fill) => fill.value)).toEqual(["me@jobs.test", "s3cret!", "s3cret!"]);
  });
  test("without a password field, email comes from the profile; without an account, passwords stay empty", () => {
    const email = field({ id: "e", kind: "email", label: "Email" });
    expect(mapping.map([email], profile, {}, null, account)[0]?.value).toBe(profile.email);
    const password = field({ id: "p", kind: "password", label: "Password" });
    expect(mapping.map([email, password], profile, {}, null)).toEqual([{ id: "e", frameId: 0, value: profile.email, source: "profile" }]);
  });
  test("saved answers never fill a password field", () => {
    const password = field({ id: "p", kind: "password", label: "Password" });
    expect(mapping.map([password], profile, { password: { question: "Password", answer: "leak", updatedAt: 0 } })).toEqual([]);
  });
});
