export type ProviderKind = "openai" | "anthropic";

export interface ProviderSettings {
  kind: ProviderKind;
  /** e.g. http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio), https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  provider: ProviderSettings;
  /** Re-fill automatically when the apply page changes (Workday multi-step). */
  autoFillOnPageChange: boolean;
  /** Analyze job automatically when a job page is detected. */
  autoAnalyze: boolean;
  salarySearch: boolean;
  /** Default login used to create accounts on job sites (Workday, iCIMS...). Stored locally only, never sent to the AI. */
  account: AccountLogin;
}

export interface AccountLogin {
  email: string;
  password: string;
}

export interface Experience {
  title: string;
  company: string;
  location: string;
  /** YYYY-MM */
  start: string;
  /** YYYY-MM or "" for current */
  end: string;
  current: boolean;
  description: string;
}

export interface Education {
  school: string;
  degree: string;
  field: string;
  /** YYYY-MM */
  start: string;
  end: string;
  gpa: string;
}

export type YesNo = "yes" | "no" | "";

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** E.164 style country code, e.g. "+1" */
  phoneCountryCode: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  website: string;
  headline: string;
  summary: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number;
  skills: string[];
  experience: Experience[];
  education: Education[];
  workAuthorized: YesNo;
  requiresSponsorship: YesNo;
  willingToRelocate: YesNo;
  salaryExpectation: string;
  /** current pay / CTC, asked by most Indian application forms */
  currentSalary: string;
  /** Plain-text digest of the user's LinkedIn profile (about, extra experience, skills, certifications, themes of recent posts); "" until imported */
  linkedinSummary: string;
  noticePeriod: string;
  /** Free-form EEO defaults; "" means decline to answer. */
  gender: string;
  ethnicity: string;
  veteranStatus: string;
  disabilityStatus: string;
  pronouns: string;
}

export interface Resume {
  text: string;
  fileName: string;
  /** base64 of the original PDF/DOCX, used to attach to file inputs */
  fileBase64: string;
  mimeType: string;
}

export interface JobPosting {
  /** stable id derived from canonical URL / site job id */
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  /** posted salary text if the page shows one */
  salaryText: string;
  employmentType: string;
  /** "linkedin" | "workday" | "jsonld" | "generic" ... */
  source: string;
}

export interface SalaryRange {
  min: number;
  max: number;
}

/** per-year pay split; null when the source does not give that part */
export interface SalaryComponents {
  base: SalaryRange | null;
  /** cash, annual target */
  bonus: SalaryRange | null;
  /** annualised: a grant counts as grant / vesting years */
  stock: SalaryRange | null;
  total: SalaryRange;
}

export interface SalaryEstimate {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month" | "hour" | "";
  /** "posted" | "web" | "estimate" */
  basis: "posted" | "web" | "estimate";
  /** how the number was derived, e.g. "Levels.fyi data for Senior SWE at Stripe" */
  note: string;
  sources: { title: string; url: string }[];
  /** only when the split is known (and at least two figures); min/max then equal components.total per year. Absent in estimates cached before it existed */
  components?: SalaryComponents;
}

/** perks and benefits stated by the posting or found on the web, grouped by category in the panel */
export interface CompanyPerks {
  items: { category: string; text: string }[];
  sources: { title: string; url: string }[];
}

export type MustHaveMet = "yes" | "partial" | "no";

export interface JobAnalysis {
  /** paragraph from analyses cached before highlights existed; new analyses leave it empty */
  summary: string;
  /** short keyword phrases: what the role works with and what is interesting about it, minus anything already in mustHave / niceToHave */
  highlights?: string[];
  mustHave: string[];
  /** the model's verdict per mustHave item, same order; absent in analyses cached before it existed */
  mustHaveMet?: MustHaveMet[];
  niceToHave: string[];
  /** 0-100 from LLM */
  matchScore: number;
  /** 0-100 deterministic keyword overlap */
  keywordScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  gaps: string[];
  verdict: string;
  salary: SalaryEstimate | null;
  /** absent in analyses cached before perks existed */
  perks?: CompanyPerks | null;
  analyzedAt: number;
}

export type JobStatus = "saved" | "applied" | "interview" | "offer" | "rejected";

export interface TrackedJob {
  job: JobPosting;
  analysis: JobAnalysis | null;
  status: JobStatus;
  notes: string;
  savedAt: number;
  updatedAt: number;
  coverLetter: string;
  /** page where the user applied and can log in to follow the application; absent on older entries */
  portalUrl?: string;
  /** login email used on that portal (never the password) */
  accountEmail?: string;
  appliedAt?: number;
}

/** A resume tailored for one job, kept so the tracker can show what was sent. */
export interface TailoredResume {
  id: string;
  jobId: string;
  /** readable label such as "Acme - Senior Engineer - Resume (13 Nov 2026)" */
  name: string;
  fileName: string;
  createdAt: number;
  /** tailored PDF; "" when the resume was rewritten as markdown */
  pdfBase64: string;
  markdown: string;
  changeCount: number;
}

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "url"
  | "date"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "combobox"
  | "file"
  | "password"
  | "contenteditable";

export interface FieldDescriptor {
  /** unique within the frame; content script stamps data-sj-id on the element */
  id: string;
  frameId: number;
  kind: FieldKind;
  /** best human label (label/aria/legend/placeholder/nearby text) */
  label: string;
  name: string;
  placeholder: string;
  automationId: string;
  required: boolean;
  /** options for select/radio/combobox (visible text) */
  options: string[];
  currentValue: string;
  /** section heading the field sits under, helps disambiguate (e.g. "Education") */
  section: string;
}

export type FillSource = "profile" | "answers" | "ai" | "resume" | "user";

export interface FieldFill {
  id: string;
  frameId: number;
  /** string value; for checkbox "true"/"false"; for radio/select/combobox the option text */
  value: string;
  source: FillSource;
}

export interface FillResult {
  id: string;
  ok: boolean;
  /** value actually present after filling */
  finalValue: string;
  error: string;
}

/** Answer bank: normalized question -> answer */
export type AnswerBank = Record<string, { question: string; answer: string; updatedAt: number }>;

/** A saved LinkedIn job search suggested during setup. */
export interface JobSearch {
  role: string;
  location: string;
  url: string;
}
