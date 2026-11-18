import { useState } from "preact/hooks";
import * as profileExtract from "../../ai/profileExtract.ts";
import * as storage from "../../storage.ts";
import type { AnswerBank, Education, Experience, Profile } from "../../types.ts";
import * as format from "../shared/format.ts";
import { AnswerBank as AnswerBankCard, type AnswerEdits } from "./answerBank.tsx";
import { Button, Card, Check, Choice, Field, SaveBar } from "../shared/controls.tsx";

type FieldSpec = { key: keyof Profile; label: string; isNarrow?: boolean; type?: "text" | "email" | "tel" | "number"; rows?: number; isYesNo?: boolean; isAmount?: boolean };

const yesNoOptions = [["", "Not set"], ["yes", "Yes"], ["no", "No"]] as const;
// an inner array is one row of side-by-side fields; a bare spec takes the full width
const groups: { title: string; note?: string; fields: (FieldSpec | FieldSpec[])[] }[] = [
  {
    title: "Contact",
    fields: [
      [{ key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" }],
      [{ key: "middleName", label: "Middle name" }],
      { key: "email", label: "Email", type: "email" },
      [{ key: "phoneCountryCode", label: "Country code", isNarrow: true }, { key: "phone", label: "Phone", type: "tel" }],
      { key: "address", label: "Address" },
      [{ key: "city", label: "City" }, { key: "state", label: "State / region" }],
      [{ key: "postalCode", label: "Postal code" }, { key: "country", label: "Country" }],
    ],
  },
  {
    title: "Links",
    fields: [
      [{ key: "linkedin", label: "LinkedIn" }, { key: "github", label: "GitHub" }],
      [{ key: "portfolio", label: "Portfolio" }, { key: "website", label: "Website" }],
    ],
  },
  {
    title: "Professional",
    fields: [
      { key: "headline", label: "Headline" },
      [{ key: "currentTitle", label: "Current title" }, { key: "currentCompany", label: "Current company" }],
      [{ key: "yearsExperience", label: "Years of experience", type: "number" }],
      { key: "summary", label: "Summary", rows: 4 },
      { key: "linkedinSummary", label: "LinkedIn digest (used for job matching and cover letters)", rows: 6 },
    ],
  },
  {
    title: "Work preferences",
    fields: [
      [{ key: "workAuthorized", label: "Authorized to work", isYesNo: true }, { key: "requiresSponsorship", label: "Requires sponsorship", isYesNo: true }],
      [{ key: "willingToRelocate", label: "Willing to relocate", isYesNo: true }],
    ],
  },
  {
    title: "Salary & notice",
    fields: [
      [{ key: "currentSalary", label: "Current salary / CTC", isAmount: true }, { key: "salaryExpectation", label: "Salary expectation", isAmount: true }],
      [{ key: "noticePeriod", label: "Notice period" }],
    ],
  },
  {
    title: "EEO (voluntary)",
    note: "Leave blank to decline to answer. SmartJob picks “prefer not to say” for blank fields.",
    fields: [
      [{ key: "gender", label: "Gender" }, { key: "pronouns", label: "Pronouns" }],
      [{ key: "ethnicity", label: "Ethnicity" }, { key: "veteranStatus", label: "Veteran status" }],
      [{ key: "disabilityStatus", label: "Disability status" }],
    ],
  },
];

interface RowSpec<T> {
  key: keyof T & string;
  label: string;
  kind?: "area" | "check";
}

const experienceFields: (RowSpec<Experience> | RowSpec<Experience>[])[] = [
  [{ key: "title", label: "Title" }, { key: "company", label: "Company" }],
  { key: "location", label: "Location" },
  [{ key: "start", label: "Start (YYYY-MM)" }, { key: "end", label: "End (YYYY-MM)" }],
  { key: "current", label: "Current role", kind: "check" },
  { key: "description", label: "Description", kind: "area" },
];
const educationFields: (RowSpec<Education> | RowSpec<Education>[])[] = [
  [{ key: "school", label: "School" }, { key: "degree", label: "Degree" }],
  [{ key: "field", label: "Field of study" }, { key: "gpa", label: "GPA" }],
  [{ key: "start", label: "Start (YYYY-MM)" }, { key: "end", label: "End (YYYY-MM)" }],
];
const blankExperience: Experience = { title: "", company: "", location: "", start: "", end: "", current: false, description: "" };
const blankEducation: Education = { school: "", degree: "", field: "", start: "", end: "", gpa: "" };

interface RowListProps<T> {
  title: string;
  items: T[];
  blank: T;
  fields: (RowSpec<T> | RowSpec<T>[])[];
  summarize: (item: T) => string;
  onChange: (items: T[]) => void;
}

function RowList<T extends object>({ title, items, blank, fields, summarize, onChange }: RowListProps<T>) {
  const setValue = (index: number, key: string, value: string | boolean) => onChange(items.map((item, at) => (at === index ? { ...item, [key]: value } : item)));
  return (
    <Card title={`${title} (${items.length})`} collapsible isOpen={items.length > 0 && items.length <= 2} actions={<Button onClick={() => onChange([...items, { ...blank }])}>Add</Button>}>
      {items.length === 0 && <p class="muted">None yet.</p>}
      {items.map((item, index) => (
        <div class="row-item">
          <h4>{summarize(item) || "New entry"}</h4>
          <div class="stack tight">
            {fields.map((entry) => {
              const renderField = ({ key, label, kind }: RowSpec<T>) => {
                const value = (item as Record<string, unknown>)[key];
                if (kind === "check") return <Check label={label} checked={!!value} onChecked={(checked) => setValue(index, key, checked)} />;
                return <Field label={label} value={String(value ?? "")} rows={kind === "area" ? 4 : undefined} onValue={(next) => setValue(index, key, next)} />;
              };
              return Array.isArray(entry) ? <div class="grid2">{entry.map(renderField)}</div> : renderField(entry);
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

const parseList = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);

export function ProfileEditor({ initial: stored, answers }: { initial: Profile; answers: AnswerBank }) {
  const initial = profileExtract.withSplitPhone(stored);
  const [profile, setProfile] = useState(initial);
  const [skillsText, setSkillsText] = useState(initial.skills.join(", "));
  const [otherPhonesText, setOtherPhonesText] = useState(initial.otherPhones.join(", "));
  const [answerEdits, setAnswerEdits] = useState<AnswerEdits>({});
  const [isSaved, setIsSaved] = useState(false);
  const isDirty = JSON.stringify({ ...profile, skills: parseList(skillsText), otherPhones: parseList(otherPhonesText) }) !== JSON.stringify(initial) || Object.keys(answerEdits).length > 0;
  const editAnswer = (key: string, answer: AnswerBank[string] | null) => {
    setAnswerEdits({ ...answerEdits, [key]: answer });
    setIsSaved(false);
  };
  const change = (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch });
    setIsSaved(false);
  };
  const setField = (key: keyof Profile, value: string) => change({ [key]: key === "yearsExperience" ? Number(value) || 0 : value } as Partial<Profile>);
  const renderProfileField = (spec: FieldSpec) =>
    spec.isYesNo ? (
      <Choice label={spec.label} value={String(profile[spec.key])} options={[...yesNoOptions]} onValue={(value) => setField(spec.key, value)} />
    ) : (
      <Field label={spec.label} type={spec.type} rows={spec.rows} value={String(profile[spec.key])} onValue={(value) => setField(spec.key, spec.isAmount ? format.groupDigits(value, format.localeForCountry(profile.country)) : value)} />
    );
  const save = async () => {
    await storage.set("profile", { ...profile, skills: parseList(skillsText), otherPhones: parseList(otherPhonesText) });
    // apply only the edited keys so answers learned meanwhile are not overwritten
    await storage.update("answers", (bank) => {
      const next = { ...bank };
      for (const [key, edit] of Object.entries(answerEdits)) {
        if (edit === null) delete next[key];
        else if (next[key]) next[key] = { ...edit, updatedAt: Date.now() };
      }
      return next;
    });
    setAnswerEdits({});
    setIsSaved(true);
  };

  return (
    <div class="stack">
      <div class="card grouped">
        {groups.map((group, index) => (
          <Card title={group.title} collapsible isOpen={index === 0}>
            {group.note && <p class="muted small">{group.note}</p>}
            <div class="stack tight">
              {group.fields.map((entry) => (Array.isArray(entry) ? <div class={entry[0]?.isNarrow ? "grid2 narrow-first" : "grid2"}>{entry.map(renderProfileField)}</div> : renderProfileField(entry)))}
              {group.title === "Contact" && (
                <Field
                  label="Other phone numbers (comma separated)"
                  value={otherPhonesText}
                  onValue={(value) => {
                    setOtherPhonesText(value);
                    setIsSaved(false);
                  }}
                />
              )}
            </div>
          </Card>
        ))}
        <Card title="Skills" collapsible>
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
      </div>
      <AnswerBankCard answers={answers} edits={answerEdits} onEdit={editAnswer} />
      <SaveBar isDirty={isDirty} isSaved={isSaved} label="Save" onSave={() => void save()} />
    </div>
  );
}
