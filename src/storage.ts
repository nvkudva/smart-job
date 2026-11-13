import type { AnswerBank, JobAnalysis, JobSearch, Profile, Resume, Settings, TailoredResume, TrackedJob } from "./types.ts";

export interface StoreShape {
  settings: Settings;
  profile: Profile;
  resume: Resume | null;
  /** keyed by JobPosting.id */
  jobs: Record<string, TrackedJob>;
  /** analysis cache for jobs not (yet) shortlisted, keyed by JobPosting.id */
  analyses: Record<string, JobAnalysis>;
  answers: AnswerBank;
  /** false shows the setup wizard; absent means "decide from existing data" (see isSetupComplete) */
  setupComplete: boolean;
  /** epoch ms of the last LinkedIn import, 0 = never */
  linkedinImportedAt: number;
  jobSearches: JobSearch[];
  /** newest first */
  tailoredResumes: TailoredResume[];
}

export const defaultSettings: Settings = {
  provider: { kind: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "", model: "qwen3.6-35b-a3b-splash" },
  autoFillOnPageChange: false,
  autoAnalyze: true,
  salarySearch: true,
  account: { email: "", password: "" },
};

export const emptyProfile: Profile = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  phoneCountryCode: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  linkedin: "",
  github: "",
  portfolio: "",
  website: "",
  headline: "",
  summary: "",
  currentTitle: "",
  currentCompany: "",
  yearsExperience: 0,
  skills: [],
  experience: [],
  education: [],
  workAuthorized: "",
  requiresSponsorship: "",
  willingToRelocate: "",
  salaryExpectation: "",
  currentSalary: "",
  linkedinSummary: "",
  noticePeriod: "",
  gender: "",
  ethnicity: "",
  veteranStatus: "",
  disabilityStatus: "",
  pronouns: "",
};

const defaults: StoreShape = {
  settings: defaultSettings,
  profile: emptyProfile,
  resume: null,
  jobs: {},
  analyses: {},
  answers: {},
  setupComplete: false,
  linkedinImportedAt: 0,
  jobSearches: [],
  tailoredResumes: [],
};

export async function get<K extends keyof StoreShape>(key: K): Promise<StoreShape[K]> {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key] as StoreShape[K] | undefined;
  if (value === undefined) return structuredClone(defaults[key]);
  if (key === "settings" || key === "profile") return { ...(defaults[key] as object), ...(value as object) } as StoreShape[K];
  return value;
}

export async function set<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

const pendingUpdates = new Map<string, Promise<unknown>>();

/** Updates to one key run one after another so two overlapping read-modify-writes cannot drop each other's change. */
export function update<K extends keyof StoreShape>(key: K, change: (current: StoreShape[K]) => StoreShape[K]): Promise<StoreShape[K]> {
  const run = async () => {
    const next = change(await get(key));
    await set(key, next);
    return next;
  };
  const queued = (pendingUpdates.get(key) ?? Promise.resolve()).then(run, run);
  pendingUpdates.set(key, queued.catch(() => undefined));
  return queued;
}

export function onChange(listener: (changedKeys: (keyof StoreShape)[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local") listener(Object.keys(changes) as (keyof StoreShape)[]);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export interface SetupEvidence {
  setupComplete?: boolean;
  settings?: unknown;
  profile?: Partial<Profile>;
}

/** Users who configured a provider and have a named profile from before the wizard existed count as done. */
export function isSetupComplete(stored: SetupEvidence): boolean {
  if (typeof stored.setupComplete === "boolean") return stored.setupComplete;
  return stored.settings !== undefined && !!stored.profile?.firstName;
}

export async function loadSetupComplete(): Promise<boolean> {
  const stored = (await chrome.storage.local.get(["setupComplete", "settings", "profile"])) as SetupEvidence;
  const isComplete = isSetupComplete(stored);
  // pinned so a profile filling in mid-wizard (or being cleared later) cannot flip the answer
  if (stored.setupComplete === undefined) await set("setupComplete", isComplete);
  return isComplete;
}

export async function exportAll(): Promise<string> {
  return JSON.stringify(await chrome.storage.local.get(null), null, 2);
}

/** Only known keys are written, so a wrong or hand-edited file cannot plant stray data. */
export async function importAll(json: string): Promise<void> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not a SmartJob export file.");
  const known = Object.entries(parsed).filter(([key]) => key in defaults);
  if (known.length === 0) throw new Error("This file has no SmartJob data.");
  await chrome.storage.local.set(Object.fromEntries(known));
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
