import { useState } from "preact/hooks";
import * as storage from "../storage.ts";
import type { Education, Experience, Profile } from "../types.ts";
import { Button, Card, Check, Choice, Field } from "./controls.tsx";

type FieldSpec = { key: keyof Profile; label: string; type?: "text" | "email" | "tel" | "number"; rows?: number; isYesNo?: boolean };

const yesNoOptions = [["", "Not set"], ["yes", "Yes"], ["no", "No"]] as const;
const groups: { title: string; note?: string; fields: FieldSpec[] }[] = [
  {
    title: "Contact",
    fields: [
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "email", label: "Email", type: "email" },
      { key: "phoneCountryCode", label: "Phone country code (+1)" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State / region" },
      { key: "postalCode", label: "Postal code" },
      { key: "country", label: "Country" },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "linkedin", label: "LinkedIn" },
      { key: "github", label: "GitHub" },
      { key: "portfolio", label: "Portfolio" },
      { key: "website", label: "Website" },
    ],
  },
  {
    title: "Professional",
    fields: [
      { key: "headline", label: "Headline" },
      { key: "currentTitle", label: "Current title" },
      { key: "currentCompany", label: "Current company" },
      { key: "yearsExperience", label: "Years of experience", type: "number" },
      { key: "summary", label: "Summary", rows: 4 },
    ],
  },
  {
    title: "Work preferences",
    fields: [
      { key: "workAuthorized", label: "Authorized to work", isYesNo: true },
      { key: "requiresSponsorship", label: "Requires sponsorship", isYesNo: true },
      { key: "willingToRelocate", label: "Willing to relocate", isYesNo: true },
    ],
  },
  {
    title: "Salary & notice",
    fields: [
      { key: "currentSalary", label: "Current salary / CTC" },
      { key: "salaryExpectation", label: "Salary expectation" },
      { key: "noticePeriod", label: "Notice period" },
    ],
  },
  {
    title: "EEO (voluntary)",
    note: "Leave blank to decline to answer. SmartJob picks “prefer not to say” for blank fields.",
    fields: [
      { key: "gender", label: "Gender" },
      { key: "ethnicity", label: "Ethnicity" },
      { key: "veteranStatus", label: "Veteran status" },
      { key: "disabilityStatus", label: "Disability status" },
      { key: "pronouns", label: "Pronouns" },
    ],
  },
];

interface RowSpec<T> {
  key: keyof T & string;
  label: string;
  kind?: "area" | "check";
}

const experienceFields: RowSpec<Experience>[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "start", label: "Start (YYYY-MM)" },
  { key: "end", label: "End (YYYY-MM)" },
  { key: "current", label: "Current role", kind: "check" },
  { key: "description", label: "Description", kind: "area" },
];
const educationFields: RowSpec<Education>[] = [
  { key: "school", label: "School" },
  { key: "degree", label: "Degree" },
  { key: "field", label: "Field of study" },
  { key: "start", label: "Start (YYYY-MM)" },
  { key: "end", label: "End (YYYY-MM)" },
  { key: "gpa", label: "GPA" },
];
const blankExperience: Experience = { title: "", company: "", location: "", start: "", end: "", current: false, description: "" };
const blankEducation: Education = { school: "", degree: "", field: "", start: "", end: "", gpa: "" };

interface RowListProps<T> {
  title: string;
  items: T[];
  blank: T;
  fields: RowSpec<T>[];
  summarize: (item: T) => string;
  onChange: (items: T[]) => void;
}

function RowList<T extends object>({ title, items, blank, fields, summarize, onChange }: RowListProps<T>) {
  const setValue = (index: number, key: string, value: string | boolean) => onChange(items.map((item, at) => (at === index ? { ...item, [key]: value } : item)));
  return (
    <Card title={title} actions={<Button onClick={() => onChange([...items, { ...blank }])}>Add</Button>}>
      {items.length === 0 && <p class="muted">None yet.</p>}
      {items.map((item, index) => (
        <div class="row-item">
          <h4>{summarize(item) || "New entry"}</h4>
          <div class="stack tight">
            {fields.map(({ key, label, kind }) => {
              const value = (item as Record<string, unknown>)[key];
              if (kind === "check") return <Check label={label} checked={!!value} onChecked={(checked) => setValue(index, key, checked)} />;
              return <Field label={label} value={String(value ?? "")} rows={kind === "area" ? 4 : undefined} onValue={(next) => setValue(index, key, next)} />;
            })}
            <Button kind="danger" onClick={() => onChange(items.filter((_, at) => at !== index))}>
              Remove
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

const parseSkills = (text: string) => text.split(",").map((skill) => skill.trim()).filter(Boolean);

export function ProfileEditor({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [skillsText, setSkillsText] = useState(initial.skills.join(", "));
  const [isSaved, setIsSaved] = useState(false);
  const change = (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch });
    setIsSaved(false);
  };
  const setField = (key: keyof Profile, value: string) => change({ [key]: key === "yearsExperience" ? Number(value) || 0 : value } as Partial<Profile>);
  const save = async () => {
    await storage.set("profile", { ...profile, skills: parseSkills(skillsText) });
    setIsSaved(true);
  };

  return (
    <div class="stack">
      <h2 class="section-title">Profile</h2>
      {groups.map((group) => (
        <Card title={group.title}>
          {group.note && <p class="muted small">{group.note}</p>}
          <div class="stack tight">
            {group.fields.map((spec) =>
              spec.isYesNo ? (
                <Choice label={spec.label} value={String(profile[spec.key])} options={[...yesNoOptions]} onValue={(value) => setField(spec.key, value)} />
              ) : (
                <Field label={spec.label} type={spec.type} rows={spec.rows} value={String(profile[spec.key])} onValue={(value) => setField(spec.key, value)} />
              ),
            )}
          </div>
        </Card>
      ))}
      <Card title="Skills">
        <Field
          label="Comma separated"
          value={skillsText}
          onValue={(value) => {
            setSkillsText(value);
            setIsSaved(false);
          }}
        />
      </Card>
      <RowList title="Experience" items={profile.experience} blank={blankExperience} fields={experienceFields} summarize={(job) => [job.title, job.company].filter(Boolean).join(" @ ")} onChange={(experience) => change({ experience })} />
      <RowList title="Education" items={profile.education} blank={blankEducation} fields={educationFields} summarize={(item) => [item.degree, item.school].filter(Boolean).join(" @ ")} onChange={(education) => change({ education })} />
      <div class="row">
        <Button kind="primary" onClick={() => void save()}>
          Save profile
        </Button>
        {isSaved && <span class="ok-text">Saved</span>}
      </div>
    </div>
  );
}
